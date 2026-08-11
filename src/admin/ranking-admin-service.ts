import type { Db } from '@/db/client';
import { withTransaction } from '@/db/client';

import type { AdminSession } from './auth/session';
import { AdminAuditLogRepository } from '@/domain/repositories/admin-audit-log-repository';
import { StoryRankingRepository } from '@/domain/repositories/story-ranking-repository';
import type { StoryRankingRow } from '@/domain/ranking-types';
import { RankingEngine } from '@/ranking/ranking-engine';

/**
 * Stage 8 — Admin ranking operations.
 *
 * Authorized, audited ranking operations for the admin surface. Ranking is
 * triggered manually for Stage 8 (no automatic scheduling).
 *
 * Authorization is structural: VIEWER is rejected even if service is called directly.
 * Ranking persistence + audit are atomic (both or neither).
 */
export class AdminRankingService {
  private readonly rankingRepo: StoryRankingRepository;
  private readonly auditRepo: AdminAuditLogRepository;
  private readonly rankingEngine: RankingEngine;

  constructor(private readonly db: Db) {
    this.rankingRepo = new StoryRankingRepository(db);
    this.auditRepo = new AdminAuditLogRepository(db);
    this.rankingEngine = new RankingEngine(db);
  }

  /**
   * Trigger ranking for one Story. Authorized operation: only mutating admins
   * (ADMIN/EDITOR) may call this. VIEWER is rejected.
   *
   * Ranking calculation (data gathering + formula) occurs outside transaction.
   * Persistence + audit occur atomically in a short transaction.
   *
   * @param session - Admin session (authorization checked)
   * @param storyId - Story to rank
   * @param publicationId - Optional publication-specific ranking
   * @param force - Force recalculation even if recent ranking exists
   */
  async triggerRanking(
    session: AdminSession,
    storyId: string,
    publicationId: string | null,
    force = false,
  ): Promise<StoryRankingRow> {
    // Structural authorization check (rejects VIEWER)
    if (session.role === 'VIEWER') {
      throw new Error('VIEWER role cannot trigger ranking');
    }

    // Prepare ranking (expensive, outside transaction)
    const prepared = await this.rankingEngine.prepareRanking(
      storyId,
      publicationId,
      force,
    );

    if (!prepared) {
      // Recent ranking exists and force=false; fetch and return it
      const existing = await this.rankingRepo.findLatestForStory(
        storyId,
        publicationId,
      );
      if (!existing) {
        throw new Error(`Story ${storyId} not found or has no data`);
      }
      return existing;
    }

    // Persist ranking + audit atomically
    let ranking: StoryRankingRow | null = null;
    await withTransaction(async (tx) => {
      // Persist ranking (within transaction)
      ranking = await this.rankingEngine.persistRanking(tx, prepared);

      // Audit log (within SAME transaction)
      await new AdminAuditLogRepository(tx).record({
        actorIdentifier: session.username,
        actorId: null,
        action: 'STORY_RANKING_TRIGGER',
        targetType: 'story',
        targetId: storyId,
        metadata: {
          publicationId,
          rankingId: ranking.id,
          rankingMethod: ranking.ranking_method,
          rankingVersion: ranking.ranking_version,
          calculatedScore: ranking.calculated_score,
          force,
        },
      });
    });

    if (!ranking) {
      throw new Error('Ranking persistence failed');
    }

    return ranking;
  }

  /**
   * View ranking history for a Story (provenance review).
   * Read-only operation (no authorization required beyond admin session).
   */
  async getRankingHistory(
    storyId: string,
    publicationId: string | null,
    limit = 50,
  ): Promise<StoryRankingRow[]> {
    return this.rankingRepo.listHistoryForStory(storyId, limit, publicationId);
  }

  /**
   * Get the current ranking for a Story.
   * Read-only operation.
   */
  async getCurrentRanking(
    storyId: string,
    publicationId: string | null,
  ): Promise<StoryRankingRow | null> {
    return this.rankingRepo.findLatestForStory(storyId, publicationId);
  }

  /**
   * List recent ranking calculations across all Stories (admin dashboard).
   * Read-only operation.
   */
  async getRecentRankings(
    publicationId: string | null,
    limit = 100,
  ): Promise<StoryRankingRow[]> {
    return this.rankingRepo.listRecent(limit, publicationId);
  }
}
