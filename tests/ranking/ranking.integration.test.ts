import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closePool, getPool, withTransaction, type Db } from '@/db/client';
import { migrate } from '@/db/migrate';

import { ArticleRepository } from '@/domain/repositories/article-repository';
import { PublicationRepository } from '@/domain/repositories/publication-repository';
import { PublicationStoryRepository } from '@/domain/repositories/publication-story-repository';
import { SourceRepository } from '@/domain/repositories/source-repository';
import { StoryRankingRepository } from '@/domain/repositories/story-ranking-repository';
import { StoryRepository } from '@/domain/repositories/story-repository';
import { RankingEngine } from '@/ranking/ranking-engine';
import {
  listPublishedStoriesRanked,
  countPublishedStoriesRanked,
} from '@/ranking/public-ranking-queries';

/**
 * Stage 8 ranking integration tests (real Postgres, DATABASE_URL-gated).
 * Each test runs inside a transaction that is always rolled back.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Stage 8 Ranking Integration', () => {
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

  it('persists ranking with version history', async () => {
    await withTransaction(async (db: Db) => {
      const { storyId } = await setupStory(db, 'ranking-persist');
      const rankingRepo = new StoryRankingRepository(db);
      const engine = new RankingEngine(db);

      // First ranking
      const ranking1 = await engine.rankStory(storyId, null, true);
      expect(ranking1.story_id).toBe(storyId);
      expect(ranking1.ranking_version).toBe('ranking-score-v1');

      // Second ranking (force)
      await new Promise((resolve) => setTimeout(resolve, 100)); // Ensure different timestamp
      const ranking2 = await engine.rankStory(storyId, null, true);
      expect(ranking2.id).not.toBe(ranking1.id);

      // History preserved
      const history = await rankingRepo.listHistoryForStory(storyId);
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(history[0]!.id).toBe(ranking2.id); // Most recent first
    }, getPool());
  });

  it.skip('publication-specific ranking wins over canonical', async () => {
    await withTransaction(async (db: Db) => {
      const { storyId, pubAId, pubBId } = await setupTwoPublications(
        db,
        'pub-precedence',
      );
      const rankingRepo = new StoryRankingRepository(db);
      const engine = new RankingEngine(db);

      // Create canonical ranking (score: ~0.5)
      await engine.rankStory(storyId, null, true);

      // Create Publication A ranking with higher editorial boost
      await attachStoryToPublication(db, storyId, pubAId, true, 20); // featured + high priority
      await engine.rankStory(storyId, pubAId, true);

      // Publication A sees its own ranking
      const pubARanking = await rankingRepo.findLatestForStory(storyId, pubAId);
      expect(pubARanking).not.toBeNull();
      expect(pubARanking!.publication_id).toBe(pubAId);
      expect(pubARanking!.calculated_score).toBeGreaterThan(1.0); // Has editorial boost

      // Publication B falls back to canonical
      const pubBRanking = await rankingRepo.findLatestForStory(storyId, pubBId);
      expect(pubBRanking).not.toBeNull();
      expect(pubBRanking!.publication_id).toBeNull(); // Canonical
      expect(pubBRanking!.calculated_score).toBeLessThan(1.0);
    }, getPool());
  });

  it('newer canonical does not override publication-specific', async () => {
    await withTransaction(async (db: Db) => {
      const { storyId, pubAId } = await setupTwoPublications(
        db,
        'canonical-no-override',
      );
      const rankingRepo = new StoryRankingRepository(db);
      const engine = new RankingEngine(db);

      // Create Publication A ranking first
      await attachStoryToPublication(db, storyId, pubAId, false, 0);
      const pubARanking = await engine.rankStory(storyId, pubAId, true);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create newer canonical ranking
      await engine.rankStory(storyId, null, true);

      // Publication A still sees its own ranking (older but publication-specific)
      const latest = await rankingRepo.findLatestForStory(storyId, pubAId);
      expect(latest!.id).toBe(pubARanking.id);
      expect(latest!.publication_id).toBe(pubAId);
    }, getPool());
  });

  it('publication A and B rankings are isolated', async () => {
    await withTransaction(async (db: Db) => {
      const { storyId, pubAId, pubBId } = await setupTwoPublications(
        db,
        'pub-isolation',
      );
      const rankingRepo = new StoryRankingRepository(db);
      const engine = new RankingEngine(db);

      // Attach story to both publications with different editorial settings
      await attachStoryToPublication(db, storyId, pubAId, true, 10); // Featured
      await attachStoryToPublication(db, storyId, pubBId, false, 0); // Not featured

      // Rank for each publication
      const rankingA = await engine.rankStory(storyId, pubAId, true);
      const rankingB = await engine.rankStory(storyId, pubBId, true);

      // Scores differ due to editorial context
      expect(rankingA.calculated_score).toBeGreaterThan(
        rankingB.calculated_score,
      );
      expect(rankingA.signals.editorialAdjustment).toBeGreaterThan(0);
      expect(rankingB.signals.editorialAdjustment).toBe(0);

      // Each publication sees its own ranking
      const latestA = await rankingRepo.findLatestForStory(storyId, pubAId);
      const latestB = await rankingRepo.findLatestForStory(storyId, pubBId);

      expect(latestA!.publication_id).toBe(pubAId);
      expect(latestB!.publication_id).toBe(pubBId);
      expect(latestA!.calculated_score).not.toBe(latestB!.calculated_score);
    }, getPool());
  });

  it('suppress_ranking excludes story from public lists', async () => {
    await withTransaction(async (db: Db) => {
      const { storyId, pubAId } = await setupTwoPublications(db, 'suppress');
      const engine = new RankingEngine(db);

      // Attach and rank story
      await attachStoryToPublication(db, storyId, pubAId, false, 0);
      await engine.rankStory(storyId, pubAId, true);
      await publishStory(db, storyId, pubAId);

      // Story appears in ranked list
      let stories = await listPublishedStoriesRanked(db, pubAId, 10);
      expect(stories.some((s) => s.id === storyId)).toBe(true);

      // Suppress the story
      await suppressStory(db, storyId, pubAId);

      // Story excluded from ranked list
      stories = await listPublishedStoriesRanked(db, pubAId, 10);
      expect(stories.some((s) => s.id === storyId)).toBe(false);
    }, getPool());
  });

  it('unpublished story never appears in public ranked lists', async () => {
    await withTransaction(async (db: Db) => {
      const { storyId, pubAId } = await setupTwoPublications(db, 'unpublished');
      const engine = new RankingEngine(db);

      // Attach story but DO NOT publish
      await attachStoryToPublication(db, storyId, pubAId, false, 0);
      await engine.rankStory(storyId, pubAId, true);

      // Story not in public list
      const stories = await listPublishedStoriesRanked(db, pubAId, 10);
      expect(stories.some((s) => s.id === storyId)).toBe(false);

      const count = await countPublishedStoriesRanked(db, pubAId);
      expect(count).toBe(0);
    }, getPool());
  });

  it('ranking does not mutate Story membership', async () => {
    await withTransaction(async (db: Db) => {
      const { storyId, articleId } = await setupStory(
        db,
        'no-mutation-membership',
      );
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
      const { articleId, storyId } = await setupStory(
        db,
        'no-mutation-article',
      );
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

  it('concurrent ranking writes are safe', async () => {
    await withTransaction(async (db: Db) => {
      const { storyId } = await setupStory(db, 'concurrent');
      const engine = new RankingEngine(db);

      // Trigger multiple rankings concurrently
      const promises = Array.from({ length: 5 }, () =>
        engine.rankStory(storyId, null, true),
      );

      const rankings = await Promise.all(promises);

      // All succeeded
      expect(rankings).toHaveLength(5);
      rankings.forEach((r) => {
        expect(r.story_id).toBe(storyId);
      });

      // Multiple versions created
      const history = await new StoryRankingRepository(db).listHistoryForStory(
        storyId,
      );
      expect(history.length).toBeGreaterThanOrEqual(5);
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

async function publishStory(
  db: Db,
  storyId: string,
  publicationId: string,
): Promise<void> {
  const psRepo = new PublicationStoryRepository(db);
  const ps = await psRepo.findByPublicationAndStory(publicationId, storyId);
  if (ps) {
    await psRepo.setStatus(ps.id, 'PUBLISHED');
  }
}

async function suppressStory(
  db: Db,
  storyId: string,
  publicationId: string,
): Promise<void> {
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
