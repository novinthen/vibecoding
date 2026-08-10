import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FakeEmbeddingProvider } from '@/clustering/embedding/fake-provider';
import { ensureArticleEmbedding } from '@/clustering/embedding/service';
import { parseVector } from '@/clustering/candidates';
import { cosineSimilarity } from '@/clustering/scoring';
import { closePool, getPool } from '@/db/client';
import { migrate } from '@/db/migrate';
import {
  ArticleRepository,
  StoryEmbeddingRepository,
  StoryRepository,
} from '@/domain';
import type { ArticleRow } from '@/domain/types';

/**
 * Embedding persistence/versioning + nearest-neighbour integration tests
 * (DATABASE_URL-gated). Uses the deterministic fake provider — no live API.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const provider = new FakeEmbeddingProvider();

async function seedArticle(
  title: string,
): Promise<{ article: ArticleRow; sourceId: string }> {
  const pool = getPool();
  const source = await pool.query<{ id: string }>(
    `INSERT INTO sources (name, slug, source_type, authority_tier)
     VALUES ('S', 'emb-src-' || gen_random_uuid(), 'RSS', 'TRUSTED')
     RETURNING id`,
  );
  const sourceId = source.rows[0]!.id;
  const article = await new ArticleRepository(pool).create({
    sourceId,
    url: `https://example.com/${crypto.randomUUID()}`,
    originalTitle: title,
  });
  return { article, sourceId };
}

async function cleanup(articleId: string, sourceId: string): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM articles WHERE id = $1', [articleId]);
  await pool.query('DELETE FROM sources WHERE id = $1', [sourceId]);
}

describe.skipIf(!hasDb)('embedding persistence & NN (integration)', () => {
  beforeAll(async () => {
    await migrate();
  });
  afterAll(async () => {
    await closePool();
  });

  it('persists an embedding with provider/version/hash provenance', async () => {
    const { article, sourceId } = await seedArticle(
      'Claude Code ships a feature',
    );
    try {
      const result = await ensureArticleEmbedding(getPool(), provider, article);
      expect(result.computed).toBe(true);
      expect(result.row.provider).toBe('fake');
      expect(result.row.embedding_version).toBe(1);
      expect(result.row.dimensions).toBe(64);
      expect(result.row.source_content_hash).toBeTruthy();
      expect(parseVector(result.row.embedding)).toHaveLength(64);
    } finally {
      await cleanup(article.id, sourceId);
    }
  });

  it('is idempotent: unchanged content reuses the stored vector (no recompute)', async () => {
    const { article, sourceId } = await seedArticle('Idempotent embedding');
    try {
      const first = await ensureArticleEmbedding(getPool(), provider, article);
      const second = await ensureArticleEmbedding(getPool(), provider, article);
      expect(second.computed).toBe(false);
      expect(second.row.id).toBe(first.row.id);
      // The reused vector comes from storage (pgvector float4): equal up to the
      // single-precision rounding, i.e. cosine-identical to the computed vector.
      expect(second.vector).toHaveLength(first.vector.length);
      expect(cosineSimilarity(second.vector, first.vector)).toBeCloseTo(1, 6);
    } finally {
      await cleanup(article.id, sourceId);
    }
  });

  it('refreshes in place when the embedding version changes (provenance updated)', async () => {
    const { article, sourceId } = await seedArticle('Versioned embedding');
    try {
      const v1 = new FakeEmbeddingProvider({ version: 1 });
      const v2 = new FakeEmbeddingProvider({ version: 2 });
      const first = await ensureArticleEmbedding(getPool(), v1, article);
      const second = await ensureArticleEmbedding(getPool(), v2, article);
      // Same (article, model) row upserted; version advances, no duplicate row.
      expect(second.row.id).toBe(first.row.id);
      expect(second.row.embedding_version).toBe(2);
      const count = await getPool().query<{ n: string }>(
        'SELECT count(*)::text AS n FROM article_embeddings WHERE article_id = $1',
        [article.id],
      );
      expect(count.rows[0]?.n).toBe('1');
    } finally {
      await cleanup(article.id, sourceId);
    }
  });

  it('finds nearest Stories ordered by cosine distance, scoped to the model', async () => {
    const pool = getPool();
    const near = await seedArticle('Anthropic launches Claude Code capability');
    const far = await seedArticle(
      'Weather forecast rain expected this weekend',
    );
    const query = await seedArticle(
      'Anthropic launches Claude Code capability',
    );
    const storyRepo = new StoryRepository(pool);
    const storyEmb = new StoryEmbeddingRepository(pool);
    const createdStoryIds: string[] = [];
    try {
      // Build two Stories, each anchored on one seed Article's embedding.
      for (const seed of [near, far]) {
        const emb = await ensureArticleEmbedding(pool, provider, seed.article);
        const story = await storyRepo.createClustered({
          slug: `nn-${crypto.randomUUID()}`,
          canonicalTitle: seed.article.original_title,
          primaryArticleId: seed.article.id,
        });
        createdStoryIds.push(story.id);
        await storyRepo.attachArticle(story.id, seed.article.id, {
          relationshipType: 'PRIMARY',
        });
        await storyEmb.upsert(story.id, {
          provider: provider.name,
          model: provider.model,
          version: provider.version,
          dimensions: provider.dimensions,
          embedding: emb.vector,
          sourceContentHash: 'x',
        });
      }

      const queryEmb = await ensureArticleEmbedding(
        pool,
        provider,
        query.article,
      );
      const neighbours = await storyEmb.nearestStories({
        embedding: queryEmb.vector,
        model: provider.model,
        limit: 10,
      });
      // The semantically-near Story ranks first.
      expect(neighbours[0]?.story_id).toBe(createdStoryIds[0]);
      expect(neighbours[0]!.distance).toBeLessThan(0.2);

      // A different model returns nothing (dimension-scoped comparison).
      const otherModel = await storyEmb.nearestStories({
        embedding: queryEmb.vector,
        model: 'some-other-model',
        limit: 10,
      });
      expect(otherModel).toHaveLength(0);
    } finally {
      for (const id of createdStoryIds) {
        await pool.query('DELETE FROM stories WHERE id = $1', [id]);
      }
      await cleanup(near.article.id, near.sourceId);
      await cleanup(far.article.id, far.sourceId);
      await cleanup(query.article.id, query.sourceId);
    }
  });
});
