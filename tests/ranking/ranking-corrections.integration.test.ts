import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closePool, getPool, type Db } from '@/db/client';
import { migrate } from '@/db/migrate';

import { ArticleRepository } from '@/domain/repositories/article-repository';
import { PublicationRepository } from '@/domain/repositories/publication-repository';
import { PublicationStoryRepository } from '@/domain/repositories/publication-story-repository';
import { SourceRepository } from '@/domain/repositories/source-repository';
import { StoryRepository } from '@/domain/repositories/story-repository';
import { AdminRankingService } from '@/admin/ranking-admin-service';
import { RankingEngine } from '@/ranking/ranking-engine';
import {
  listPublishedStoriesRanked,
  countPublishedStoriesRanked,
} from '@/ranking/public-ranking-queries';
import type { AdminSession } from '@/admin/auth/session';

/**
 * Stage 8 ranking integration tests (real Postgres, DATABASE_URL-gated).
 * Tests do NOT use withTransaction to avoid rollback issues with ranking service.
 * Cleanup is done explicitly in finally blocks.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

const ADMIN: AdminSession = {
  username: 'admin-test',
  role: 'ADMIN',
  iat: 0,
  exp: 9e9,
};

const VIEWER: AdminSession = {
  username: 'viewer-test',
  role: 'VIEWER',
  iat: 0,
  exp: 9e9,
};

describe.skipIf(!hasDb)('Stage 8 Ranking Corrections', () => {
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

  it('publication-specific ranking beats newer canonical in public query', async () => {
    const db = getPool();
    const { storyId, pubAId } = await setupTwoPublications(db, 'pub-precedence-public');

    try {
      const engine = new RankingEngine(db);

      await attachStoryToPublication(db, storyId, pubAId, false, 5);
      const pubRanking = await engine.rankStory(storyId, pubAId, true);
      await publishStory(db, storyId, pubAId);

      await new Promise((resolve) => setTimeout(resolve, 100));

      await engine.rankStory(storyId, null, true);

      const stories = await listPublishedStoriesRanked(db, pubAId, 10);
      const story = stories.find((s) => s.id === storyId);

      expect(story).toBeDefined();
      expect(story!.ranking_score).toBe(pubRanking.calculated_score);
    } finally {
      await cleanupTest(db, storyId, pubAId);
    }
  });

  it('canonical ranking used when publication-specific does not exist', async () => {
    const db = getPool();
    const { storyId, pubAId } = await setupTwoPublications(db, 'canonical-fallback');

    try {
      const engine = new RankingEngine(db);

      const canonicalRanking = await engine.rankStory(storyId, null, true);
      await attachStoryToPublication(db, storyId, pubAId, false, 0);
      await publishStory(db, storyId, pubAId);

      const stories = await listPublishedStoriesRanked(db, pubAId, 10);
      const story = stories.find((s) => s.id === storyId);

      expect(story).toBeDefined();
      expect(story!.ranking_score).toBe(canonicalRanking.calculated_score);
    } finally {
      await cleanupTest(db, storyId, pubAId);
    }
  });

  it('publication B never receives publication A ranking', async () => {
    const db = getPool();
    const { storyId, pubAId, pubBId } = await setupTwoPublications(db, 'pub-isolation');

    try {
      const engine = new RankingEngine(db);

      await attachStoryToPublication(db, storyId, pubAId, false, 0);
      await attachStoryToPublication(db, storyId, pubBId, false, 0);

      await engine.rankStory(storyId, pubAId, true);
      await publishStory(db, storyId, pubAId);
      await publishStory(db, storyId, pubBId);

      const storiesB = await listPublishedStoriesRanked(db, pubBId, 10);
      const storyB = storiesB.find((s) => s.id === storyId);

      expect(storyB).toBeDefined();
      expect(storyB!.ranking_score).toBeNull();
    } finally {
      await cleanupTest(db, storyId, pubAId, pubBId);
    }
  });

  it('VIEWER direct service call rejected', async () => {
    const db = getPool();
    const { storyId } = await setupStory(db, 'viewer-reject');

    try {
      const service = new AdminRankingService(db);

      await expect(
        service.triggerRanking(VIEWER, storyId, null, true),
      ).rejects.toThrow('VIEWER role cannot trigger ranking');
    } finally {
      await cleanupTest(db, storyId);
    }
  });

  it('ADMIN service call accepted', async () => {
    const db = getPool();
    const { storyId } = await setupStory(db, 'admin-accept');

    try {
      const service = new AdminRankingService(db);

      const ranking = await service.triggerRanking(ADMIN, storyId, null, true);
      expect(ranking).toBeDefined();
      expect(ranking.story_id).toBe(storyId);
    } finally {
      await cleanupTest(db, storyId);
    }
  });

  it('suppression excludes from /top ordering', async () => {
    const db = getPool();
    const { storyId, pubAId } = await setupTwoPublications(db, 'suppress-top');

    try {
      const engine = new RankingEngine(db);

      await attachStoryToPublication(db, storyId, pubAId, false, 0);
      await engine.rankStory(storyId, pubAId, true);
      await publishStory(db, storyId, pubAId);

      let stories = await listPublishedStoriesRanked(db, pubAId, 10);
      expect(stories.some((s) => s.id === storyId)).toBe(true);

      await suppressStory(db, storyId, pubAId);

      stories = await listPublishedStoriesRanked(db, pubAId, 10);
      expect(stories.some((s) => s.id === storyId)).toBe(false);
    } finally {
      await cleanupTest(db, storyId, pubAId);
    }
  });

  it('unpublished story never appears in /top', async () => {
    const db = getPool();
    const { storyId, pubAId } = await setupTwoPublications(db, 'unpublished-exclude');

    try {
      const engine = new RankingEngine(db);

      await attachStoryToPublication(db, storyId, pubAId, false, 0);
      await engine.rankStory(storyId, pubAId, true);

      const stories = await listPublishedStoriesRanked(db, pubAId, 10);
      expect(stories.some((s) => s.id === storyId)).toBe(false);

      const count = await countPublishedStoriesRanked(db, pubAId);
      expect(count).toBe(0);
    } finally {
      await cleanupTest(db, storyId, pubAId);
    }
  });

  it('ranking does not mutate StoryArticles', async () => {
    const db = getPool();
    const { storyId, articleId } = await setupStory(db, 'no-mutation-sa');

    try {
      const storyRepo = new StoryRepository(db);
      const engine = new RankingEngine(db);

      const membersBefore = await storyRepo.listArticleIds(storyId);
      expect(membersBefore).toEqual([articleId]);

      await engine.rankStory(storyId, null, true);

      const membersAfter = await storyRepo.listArticleIds(storyId);
      expect(membersAfter).toEqual(membersBefore);
    } finally {
      await cleanupTest(db, storyId);
    }
  });

  it('ranking does not mutate Article source facts', async () => {
    const db = getPool();
    const { articleId, storyId } = await setupStory(db, 'no-mutation-article');

    try {
      const articleRepo = new ArticleRepository(db);
      const engine = new RankingEngine(db);

      const articleBefore = await articleRepo.findById(articleId);
      const titleBefore = articleBefore!.original_title;
      const urlBefore = articleBefore!.url;

      await engine.rankStory(storyId, null, true);

      const articleAfter = await articleRepo.findById(articleId);
      expect(articleAfter!.original_title).toBe(titleBefore);
      expect(articleAfter!.url).toBe(urlBefore);
    } finally {
      await cleanupTest(db, storyId);
    }
  });

  it('/top ordering follows persisted final score (featured tier first)', async () => {
    const db = getPool();
    const { pubAId } = await setupTwoPublications(db, 'top-ordering');

    const story1 = await setupStory(db, 'story1');
    const story2 = await setupStory(db, 'story2');
    const story3 = await setupStory(db, 'story3');

    try {
      const engine = new RankingEngine(db);

      await attachStoryToPublication(db, story1.storyId, pubAId, false, 10);
      await engine.rankStory(story1.storyId, pubAId, true);
      await publishStory(db, story1.storyId, pubAId);

      await attachStoryToPublication(db, story2.storyId, pubAId, true, 0);
      await engine.rankStory(story2.storyId, pubAId, true);
      await publishStory(db, story2.storyId, pubAId);

      await attachStoryToPublication(db, story3.storyId, pubAId, false, 0);
      await engine.rankStory(story3.storyId, pubAId, true);
      await publishStory(db, story3.storyId, pubAId);

      const stories = await listPublishedStoriesRanked(db, pubAId, 10);

      expect(stories[0]!.featured).toBe(true);
      expect(stories[0]!.id).toBe(story2.storyId);

      expect(stories[1]!.id).toBe(story1.storyId);
    } finally {
      await cleanupTest(db, story1.storyId);
      await cleanupTest(db, story2.storyId);
      await cleanupTest(db, story3.storyId);
      await cleanupTest(db, null, pubAId);
    }
  });
});

// Helper functions

async function setupStory(
  db: Db,
  slug: string,
): Promise<{ storyId: string; articleId: string; sourceId: string }> {
  const sourceRepo = new SourceRepository(db);
  const articleRepo = new ArticleRepository(db);
  const storyRepo = new StoryRepository(db);

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

async function setupTwoPublications(
  db: Db,
  slug: string,
): Promise<{ storyId: string; pubAId: string; pubBId: string }> {
  const { storyId } = await setupStory(db, slug);
  const pubRepo = new PublicationRepository(db);

  const uniqueSlug = `${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const pubA = await pubRepo.create({
    name: `Publication A ${uniqueSlug}`,
    slug: `pub-a-${uniqueSlug}`,
    defaultLocale: 'en',
    timezone: 'UTC',
  });

  const pubB = await pubRepo.create({
    name: `Publication B ${uniqueSlug}`,
    slug: `pub-b-${uniqueSlug}`,
    defaultLocale: 'en',
    timezone: 'UTC',
  });

  return { storyId, pubAId: pubA.id, pubBId: pubB.id };
}

async function attachStoryToPublication(
  db: Db,
  storyId: string,
  publicationId: string,
  featured: boolean,
  priority: number,
): Promise<void> {
  const psRepo = new PublicationStoryRepository(db);
  await psRepo.create({
    publicationId,
    storyId,
    values: {
      slug: `story-${storyId.slice(0, 8)}`,
      headline: 'Test Story',
      publishedSummary: null,
      publishedWhyItMatters: null,
      featured,
      editorialPriority: priority,
      suppressRanking: false,
    },
  });
}

async function publishStory(db: Db, storyId: string, publicationId: string): Promise<void> {
  const psRepo = new PublicationStoryRepository(db);
  const ps = await psRepo.findByPublicationAndStory(publicationId, storyId);
  if (ps) {
    await psRepo.setStatus(ps.id, 'PUBLISHED');
  }
}

async function suppressStory(db: Db, storyId: string, publicationId: string): Promise<void> {
  const psRepo = new PublicationStoryRepository(db);
  const ps = await psRepo.findByPublicationAndStory(publicationId, storyId);
  if (ps) {
    await psRepo.update(ps.id, {
      slug: ps.slug ?? `story-${storyId.slice(0, 8)}`,
      headline: ps.headline,
      publishedSummary: ps.published_summary,
      publishedWhyItMatters: ps.published_why_it_matters,
      featured: ps.featured,
      editorialPriority: ps.editorial_priority,
      suppressRanking: true,
    });
  }
}

async function cleanupTest(
  db: Db,
  storyId: string | null,
  ...publicationIds: (string | null)[]
): Promise<void> {
  try {
    if (storyId) {
      await db.query('DELETE FROM admin_audit_log WHERE target_type = $1 AND target_id = $2', ['story', storyId]);
      await db.query('DELETE FROM story_rankings WHERE story_id = $1', [storyId]);
      await db.query('DELETE FROM publication_stories WHERE story_id = $1', [storyId]);
      await db.query('DELETE FROM story_articles WHERE story_id = $1', [storyId]);
      await db.query('DELETE FROM stories WHERE id = $1', [storyId]);
      await db.query('DELETE FROM articles WHERE id IN (SELECT article_id FROM story_articles WHERE story_id = $1)', [storyId]);
    }
    for (const pubId of publicationIds) {
      if (pubId) {
        await db.query('DELETE FROM publications WHERE id = $1', [pubId]);
      }
    }
  } catch (err) {
    // Cleanup errors are non-fatal
    console.error('Cleanup error:', err);
  }
}
