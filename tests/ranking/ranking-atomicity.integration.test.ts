import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closePool, getPool, withTransaction, type Db } from '@/db/client';
import { migrate } from '@/db/migrate';

import { ArticleRepository } from '@/domain/repositories/article-repository';
import { PublicationRepository } from '@/domain/repositories/publication-repository';
import { PublicationStoryRepository } from '@/domain/repositories/publication-story-repository';
import { SourceRepository } from '@/domain/repositories/source-repository';
import { StoryRankingRepository } from '@/domain/repositories/story-ranking-repository';
import { StoryRepository } from '@/domain/repositories/story-repository';
import { AdminAuditLogRepository } from '@/domain/repositories/admin-audit-log-repository';
import { AdminRankingService } from '@/admin/ranking-admin-service';
import type { AdminSession } from '@/admin/auth/session';

/**
 * Stage 8 ranking + audit atomicity tests.
 *
 * Tests verify that ranking persistence and audit logging are truly atomic:
 * - Both succeed together
 * - Both fail together
 * - No partial commits
 */
const hasDb = Boolean(process.env.DATABASE_URL);

const ADMIN: AdminSession = {
  username: 'admin-atomicity',
  role: 'ADMIN',
  iat: 0,
  exp: 9e9,
};

const VIEWER: AdminSession = {
  username: 'viewer-atomicity',
  role: 'VIEWER',
  iat: 0,
  exp: 9e9,
};

describe.skipIf(!hasDb)('Stage 8 Ranking + Audit Atomicity', () => {
  beforeAll(async () => {
    if (hasDb) {
      await migrate();
    }
  });

  afterAll(async () => {
    if (hasDb) {
      await closePool();
    }
  });

  it('successful admin ranking creates both ranking and audit rows', async () => {
    // NOT using outer test transaction - test at production transaction boundary
    const db = getPool();
    const { storyId } = await setupStory(db, 'atomic-success');

    const rankingRepoOuter = new StoryRankingRepository(db);
    const auditRepoOuter = new AdminAuditLogRepository(db);

    // Count before
    const rankingsBefore = await rankingRepoOuter.listHistoryForStory(storyId);
    const auditsBefore = await auditRepoOuter.listRecent({ targetType: 'story', targetId: storyId });

    const beforeRankingCount = rankingsBefore.length;
    const beforeAuditCount = auditsBefore.length;

    // Trigger ranking via admin service
    const service = new AdminRankingService(db);
    const ranking = await service.triggerRanking(ADMIN, storyId, null, true);

    // Count after
    const rankingsAfter = await rankingRepoOuter.listHistoryForStory(storyId);
    const auditsAfter = await auditRepoOuter.listRecent({ targetType: 'story', targetId: storyId });

    // Both were created
    expect(rankingsAfter.length).toBe(beforeRankingCount + 1);
    expect(auditsAfter.length).toBe(beforeAuditCount + 1);

    // Ranking matches
    expect(rankingsAfter[0]!.id).toBe(ranking.id);

    // Audit references ranking
    const audit = auditsAfter[0]!;
    expect(audit.action).toBe('STORY_RANKING_TRIGGER');
    expect(audit.target_type).toBe('story');
    expect(audit.target_id).toBe(storyId);
    expect(audit.metadata).toMatchObject({
      rankingId: ranking.id,
    });

    // Cleanup
    await db.query('DELETE FROM story_rankings WHERE story_id = $1', [storyId]);
    await db.query('DELETE FROM admin_audit_log WHERE target_type = $1 AND target_id = $2', ['story', storyId]);
    await db.query('DELETE FROM story_articles WHERE story_id = $1', [storyId]);
    await db.query('DELETE FROM stories WHERE id = $1', [storyId]);
  });

  it('simulated audit failure causes ranking rollback', async () => {
    // Test atomicity by forcing audit failure
    const db = getPool();
    const { storyId } = await setupStory(db, 'atomic-rollback');

    const rankingRepoOuter = new StoryRankingRepository(db);

    // Count before
    const rankingsBefore = await rankingRepoOuter.listHistoryForStory(storyId);
    const beforeCount = rankingsBefore.length;

    // Create a service that will fail during audit
    const service = new AdminRankingService(db);

    // Mock/break the audit by using an invalid session that will cause failure
    // We'll use a different approach: trigger ranking, then verify atomicity by
    // checking that if we manually simulate transaction failure, both are rolled back

    // Actually, let's test the real atomicity boundary:
    // Prepare ranking, then fail during persistence transaction
    const engine = service['rankingEngine'];
    const prepared = await engine.prepareRanking(storyId, null, true);

    if (!prepared) {
      throw new Error('Should have prepared ranking');
    }

    // Now simulate transaction failure by trying to persist with a broken transaction
    let errorThrown = false;
    try {
      await withTransaction(async (tx) => {
        // Persist ranking
        await engine.persistRanking(tx, prepared);

        // Persist audit
        await new AdminAuditLogRepository(tx).record({
          actorIdentifier: ADMIN.username,
          actorId: null,
          action: 'STORY_RANKING_TRIGGER',
          targetType: 'story',
          targetId: storyId,
          metadata: { test: 'fail' },
        });

        // Force transaction rollback
        throw new Error('Simulated audit failure');
      });
    } catch (err: any) {
      errorThrown = true;
      expect(err.message).toContain('Simulated audit failure');
    }

    expect(errorThrown).toBe(true);

    // Count after - should be unchanged (rollback)
    const rankingsAfter = await rankingRepoOuter.listHistoryForStory(storyId);
    expect(rankingsAfter.length).toBe(beforeCount);

    // Cleanup
    await db.query('DELETE FROM story_articles WHERE story_id = $1', [storyId]);
    await db.query('DELETE FROM stories WHERE id = $1', [storyId]);
  });

  it('VIEWER direct service call rejected', async () => {
    const db = getPool();
    const { storyId } = await setupStory(db, 'viewer-reject-atomicity');
    const service = new AdminRankingService(db);

    await expect(
      service.triggerRanking(VIEWER, storyId, null, true),
    ).rejects.toThrow('VIEWER role cannot trigger ranking');

    // Cleanup
    await db.query('DELETE FROM story_articles WHERE story_id = $1', [storyId]);
    await db.query('DELETE FROM stories WHERE id = $1', [storyId]);
  });

  it('ADMIN service call accepted and atomic', async () => {
    const db = getPool();
    const { storyId } = await setupStory(db, 'admin-accept-atomicity');
    const service = new AdminRankingService(db);

    const rankingRepo = new StoryRankingRepository(db);
    const auditRepo = new AdminAuditLogRepository(db);

    const rankingsBefore = await rankingRepo.listHistoryForStory(storyId);
    const auditsBefore = await auditRepo.listRecent({ targetType: 'story', targetId: storyId });

    const ranking = await service.triggerRanking(ADMIN, storyId, null, true);

    const rankingsAfter = await rankingRepo.listHistoryForStory(storyId);
    const auditsAfter = await auditRepo.listRecent({ targetType: 'story', targetId: storyId });

    // Both created
    expect(rankingsAfter.length).toBe(rankingsBefore.length + 1);
    expect(auditsAfter.length).toBe(auditsBefore.length + 1);
    expect(ranking).toBeDefined();

    // Cleanup
    await db.query('DELETE FROM story_rankings WHERE story_id = $1', [storyId]);
    await db.query('DELETE FROM admin_audit_log WHERE target_type = $1 AND target_id = $2', ['story', storyId]);
    await db.query('DELETE FROM story_articles WHERE story_id = $1', [storyId]);
    await db.query('DELETE FROM stories WHERE id = $1', [storyId]);
  });
});

// Helper function - creates Story without outer transaction
async function setupStory(
  db: Db,
  slug: string,
): Promise<{ storyId: string; articleId: string; sourceId: string }> {
  const sourceRepo = new SourceRepository(db);
  const articleRepo = new ArticleRepository(db);
  const storyRepo = new StoryRepository(db);

  // Use unique slug with timestamp to avoid collisions
  const uniqueSlug = `${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const source = await sourceRepo.create({
    name: `Source ${uniqueSlug}`,
    slug: `source-${uniqueSlug}`,
    sourceType: 'RSS',
    authorityTier: 'PRIMARY',
  });

  const article = await articleRepo.create({
    sourceId: source.id,
    url: `https://example.com/${uniqueSlug}`,
    originalTitle: `Article ${uniqueSlug}`,
  });

  const story = await storyRepo.createClustered({
    slug: `story-${uniqueSlug}`,
    canonicalTitle: `Story ${uniqueSlug}`,
    primaryArticleId: article.id,
    lastActivityAt: new Date(),
  });

  await storyRepo.attachArticle(story.id, article.id);

  return { storyId: story.id, articleId: article.id, sourceId: source.id };
}
