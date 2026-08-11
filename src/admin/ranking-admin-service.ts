import type { Db } from '@/db/client';

import { AdminAuditLogRepository } from '@/domain/repositories/admin-audit-log-repository';
import { StoryRankingRepository } from '@/domain/repositories/story-ranking-repository';
import type { StoryRankingRow } from '@/domain/ranking-types';
import { RankingEngine } from '@/ranking/ranking-engine';

/**
 * Stage 8 — Admin ranking operations.
 *
 * Authorized, audited ranking operations for the admin surface. Ranking is
 * triggered manually for Stage 8 (no automatic scheduling).
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
   * (ADMIN/EDITOR) may call this. Creates an audit log record.
   *
   * @param storyId - Story to rank
   * @param publicationId - Optional publication-specific ranking
   * @param actorId - Admin performing the action (for audit)
   * @param force - Force recalculation even if recent ranking exists
   */
  async triggerRanking(
    storyId: string,
    publicationId: string | null,
    actorId: string,
    force = false,
  ): Promise<StoryRankingRow> {
    const ranking = await this.rankingEngine.rankStory(
      storyId,
      publicationId,
      force,
    );

    // Audit log
    await this.auditRepo.record({
      actorIdentifier: actorId,
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

    return ranking;
  }

  /**
   * View ranking history for a Story (provenance review).
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
   */
  async getCurrentRanking(
    storyId: string,
    publicationId: string | null,
  ): Promise<StoryRankingRow | null> {
    return this.rankingRepo.findLatestForStory(storyId, publicationId);
  }

  /**
   * List recent ranking calculations across all Stories (admin dashboard).
   */
  async getRecentRankings(
    publicationId: string | null,
    limit = 100,
  ): Promise<StoryRankingRow[]> {
    return this.rankingRepo.listRecent(limit, publicationId);
  }

  /**
   * Batch-rank multiple Stories. Used for manual bulk recalculation.
   * Returns successful rankings; logs failures but continues.
   */
  async batchRankStories(
    storyIds: string[],
    publicationId: string | null,
    actorId: string,
  ): Promise<{ successful: number; failed: number; rankings: StoryRankingRow[] }> {
    const rankings = await this.rankingEngine.rankStories(storyIds, publicationId);

    // Audit the batch operation
    await this.auditRepo.record({
      actorIdentifier: actorId,
      action: 'STORY_RANKING_BATCH',
      targetType: 'story',
      targetId: null,
      metadata: {
        publicationId,
        storyCount: storyIds.length,
        successfulCount: rankings.length,
        failedCount: storyIds.length - rankings.length,
      },
    });

    return {
      successful: rankings.length,
      failed: storyIds.length - rankings.length,
      rankings,
    };
  }
}
