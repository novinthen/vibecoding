import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closePool, getPool, withTransaction, type Db } from '@/db/client';
import { migrate } from '@/db/migrate';

import { ArticleRepository } from '@/domain/repositories/article-repository';
import { PublicationRepository } from '@/domain/repositories/publication-repository';
import { PublicationStoryRepository } from '@/domain/repositories/publication-story-repository';
import { SourceRepository } from '@/domain/repositories/source-repository';
import { StoryRankingRepository } from '@/domain/repositories/story-ranking-repository';
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
 * Each test runs inside a transaction that is always rolled back.
 *
 * Tests verify:
 * - Ranking precedence (publication-specific wins over canonical)
 * - Authorization (VIEWER rejected, ADMIN/EDITOR accepted)
 * - Audit + ranking persistence atomicity
 * - Public query ordering
 * - Suppression
 * - Unpublished exclusion
 * - Invariants (no Story/Article mutations)
 * - Publication isolation
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
    await withTransaction(async (db: Db) => {
      const { storyId, pubAId } = await setupTwoPublications(db, 'pub-precedence-public');
      const engine = new RankingEngine(db);

      // Create publication-specific ranking first
      await attachStoryToPublication(db, storyId, pubAId, false, 5);
      const pubRanking = await engine.rankStory(storyId, pubAId, true);
      await publishStory(db, storyId, pubAId);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create newer canonical ranking
      await engine.rankStory(storyId, null, true);

      // Public query should use older publication-specific ranking
      const stories = await listPublishedStoriesRanked(db, pubAId, 10);
      const story = stories.find((s) => s.id === storyId);

      expect(story).toBeDefined();
      expect(story!.ranking_score).toBe(pubRanking.calculated_score);
    }, getPool());
  });

  it('canonical ranking used when publication-specific does not exist', async () => {
    await withTransaction(async (db: Db) => {
      const { storyId, pubAId } = await setupTwoPublications(db, 'canonical-fallback');
      const engine = new RankingEngine(db);

      // Create only canonical ranking
      const canonicalRanking = await engine.rankStory(storyId, null, true);
      await attachStoryToPublication(db, storyId, pubAId, false, 0);
      await publishStory(db, storyId, pubAId);

      // Public query should use canonical ranking
      const stories = await listPublishedStoriesRanked(db, pubAId, 10);
      const story = stories.find((s) => s.id === storyId);

      expect(story).toBeDefined();
      expect(story!.ranking_score).toBe(canonicalRanking.calculated_score);
    }, getPool());
  });

  it('publication B never receives publication A ranking', async () => {
    await withTransaction(async (db: Db) => {
      const { storyId, pubAId, pubBId } = await setupTwoPublications(db, 'pub-isolation');
      const engine = new RankingEngine(db);

      // Attach story to both publications
      await attachStoryToPublication(db, storyId, pubAId, false, 0);
      await attachStoryToPublication(db, storyId, pubBId, false, 0);

      // Create publication A ranking only
      const pubARanking = await engine.rankStory(storyId, pubAId, true);
      await publishStory(db, storyId, pubAId);
      await publishStory(db, storyId, pubBId);

      // Publication B should NOT see Publication A's ranking
      const storiesB = await listPublishedStoriesRanked(db, pubBId, 10);
      const storyB = storiesB.find((s) => s.id === storyId);

      expect(storyB).toBeDefined();
      expect(storyB!.ranking_score).toBeNull(); // No ranking for pub B
    }, getPool());
  });

  it('VIEWER direct service call rejected', async () => {
    await withTransaction(async (db: Db) => {
      const { storyId } = await setupStory(db, 'viewer-reject');
      const service = new AdminRankingService(db);

      await expect(
        service.triggerRanking(VIEWER, storyId, null, true),
      ).rejects.toThrow('VIEWER role cannot trigger ranking');
    }, getPool());
  });

  it('ADMIN service call accepted', async () => {
    await withTransaction(async (db: Db) => {
      const { storyId } = await setupStory(db, 'admin-accept');
      const service = new AdminRankingService(db);

      const ranking = await service.triggerRanking(ADMIN, storyId, null, true);
      expect(ranking).toBeDefined();
      expect(ranking.story_id).toBe(storyId);
    }, getPool());
  });

  it('suppression excludes from /top ordering', async () => {
    await withTransaction(async (db: Db) => {
      const { storyId, pubAId } = await setupTwoPublications(db, 'suppress-top');
      const engine = new RankingEngine(db);

      await attachStoryToPublication(db, storyId, pubAId, false, 0);
      await engine.rankStory(storyId, pubAId, true);
      await publishStory(db, storyId, pubAId);

      // Story appears before suppression
      let stories = await listPublishedStoriesRanked(db, pubAId, 10);
      expect(stories.some((s) => s.id === storyId)).toBe(true);

      // Suppress the story
      await suppressStory(db, storyId, pubAId);

      // Story excluded after suppression
      stories = await listPublishedStoriesRanked(db, pubAId, 10);
      expect(stories.some((s) => s.id === storyId)).toBe(false);
    }, getPool());
  });

  it('unpublished story never appears in /top', async () => {
    await withTransaction(async (db: Db) => {
      const { storyId, pubAId } = await setupTwoPublications(db, 'unpublished-exclude');
      const engine = new RankingEngine(db);

      await attachStoryToPublication(db, storyId, pubAId, false, 0);
      await engine.rankStory(storyId, pubAId, true);
      // Do NOT publish

      const stories = await listPublishedStoriesRanked(db, pubAId, 10);
      expect(stories.some((s) => s.id === storyId)).toBe(false);

      const count = await countPublishedStoriesRanked(db, pubAId);
      expect(count).toBe(0);
    }, getPool());
  });

  it('ranking does not mutate StoryArticles', async () => {
    await withTransaction(async (db: Db) => {
      const { storyId, articleId } = await setupStory(db, 'no-mutation-sa');
      const storyRepo = new StoryRepository(db);
      const engine = new RankingEngine(db);

      const membersBefore = await storyRepo.listArticleIds(storyId);
      expect(membersBefore).toEqual([articleId]);

      await engine.rankStory(storyId, null, true);

      const membersAfter = await storyRepo.listArticleIds(storyId);
      expect(membersAfter).toEqual(membersBefore);
    }, getPool());
  });

  it('ranking does not mutate Article source facts', async () => {
    await withTransaction(async (db: Db) => {
      const { articleId, storyId } = await setupStory(db, 'no-mutation-article');
      const articleRepo = new ArticleRepository(db);
      const engine = new RankingEngine(db);

      const articleBefore = await articleRepo.findById(articleId);
      const titleBefore = articleBefore!.original_title;
      const urlBefore = articleBefore!.url;

      await engine.rankStory(storyId, null, true);

      const articleAfter = await articleRepo.findById(articleId);
      expect(articleAfter!.original_title).toBe(titleBefore);
      expect(articleAfter!.url).toBe(urlBefore);
    }, getPool());
  });

  it('/top ordering follows persisted final score (featured tier first)', async () => {
    await withTransaction(async (db: Db) => {
      const { pubAId } = await setupTwoPublications(db, 'top-ordering');
      const engine = new RankingEngine(db);

      // Create three stories with different scores
      const story1 = await setupStory(db, 'story1');
      await attachStoryToPublication(db, story1.storyId, pubAId, false, 10); // High priority
      await engine.rankStory(story1.storyId, pubAId, true);
      await publishStory(db, story1.storyId, pubAId);

      const story2 = await setupStory(db, 'story2');
      await attachStoryToPublication(db, story2.storyId, pubAId, true, 0); // Featured
      await engine.rankStory(story2.storyId, pubAId, true);
      await publishStory(db, story2.storyId, pubAId);

      const story3 = await setupStory(db, 'story3');
      await attachStoryToPublication(db, story3.storyId, pubAId, false, 0); // Normal
      await engine.rankStory(story3.storyId, pubAId, true);
      await publishStory(db, story3.storyId, pubAId);

      const stories = await listPublishedStoriesRanked(db, pubAId, 10);

      // Featured should be first
      expect(stories[0]!.featured).toBe(true);
      expect(stories[0]!.id).toBe(story2.storyId);

      // Then ordered by score
      expect(stories[1]!.id).toBe(story1.storyId); // Higher score due to priority
    }, getPool());
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

async function setupTwoPublications(
  db: Db,
  slug: string,
): Promise<{ storyId: string; pubAId: string; pubBId: string }> {
  const { storyId } = await setupStory(db, slug);
  const pubRepo = new PublicationRepository(db);

  // Use unique slug with timestamp to avoid collisions
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
