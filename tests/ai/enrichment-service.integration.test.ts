import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AiProviderError } from '@/ai/provider/errors';
import { FakeProvider } from '@/ai/provider/fake-provider';
import {
  ArticleNotFoundError,
  enrichArticle,
  EnrichmentIneligibleError,
} from '@/ai/enrichment/service';
import { resolveSuggestions } from '@/ai/enrichment/suggestions';
import { closePool, getPool, type Db } from '@/db/client';
import { migrate } from '@/db/migrate';
import {
  ArticleEnrichmentRepository,
  ArticleRepository,
  EntityRepository,
  TopicRepository,
} from '@/domain';
import { ENRICHMENT_LOCK_NAMESPACE } from '@/domain/repositories/article-enrichment-repository';
import type { ArticleRow } from '@/domain/types';

/**
 * Enrichment service integration tests (real Postgres, DATABASE_URL-gated).
 *
 * These call the NORMAL public path — `enrichArticle(provider, articleId, ...)` —
 * with NO caller-managed transaction, exactly as the application does. The
 * repository owns its own short persistence transaction, so the tests both prove
 * the behaviour and prove the caller needs no transaction handling. Because the
 * path commits real rows, each test cleans up after itself (deleting the Article
 * cascades its enrichments).
 */
const hasDb = Boolean(process.env.DATABASE_URL);

const VALID_OUTPUT = {
  relevance: 'RELEVANT',
  relevanceReason: 'Directly about a coding agent.',
  summary: 'A coding agent shipped a new feature.',
  whyItMatters: 'It speeds up developer workflows.',
  suggestedTopics: [
    { name: 'Coding Agents', slug: 'coding-agents' },
    { name: 'Totally Made Up Topic' },
  ],
  suggestedEntities: [
    { name: 'Claude Code', type: 'PRODUCT', confidence: 0.9 },
    { name: 'Nonexistent Tool 9000' },
  ],
  confidence: 0.87,
};

interface Seeded {
  article: ArticleRow;
  sourceId: string;
}

/** Seed a committed Article (its own transaction) for a test. */
async function seedArticle(
  overrides: { status?: string } = {},
): Promise<Seeded> {
  const pool = getPool();
  const source = await pool.query<{ id: string }>(
    `INSERT INTO sources (name, slug, source_type, authority_tier)
     VALUES ('S', 'enrich-src-' || gen_random_uuid(), 'RSS', 'TRUSTED')
     RETURNING id`,
  );
  const sourceId = source.rows[0]!.id;
  let article = await new ArticleRepository(pool).create({
    sourceId,
    url: `https://example.com/${crypto.randomUUID()}`,
    originalTitle: 'A new coding agent',
    originalExcerpt: 'It writes code for you.',
  });
  if (overrides.status) {
    const updated = await pool.query<ArticleRow>(
      'UPDATE articles SET status = $2 WHERE id = $1 RETURNING *',
      [article.id, overrides.status],
    );
    article = updated.rows[0]!;
  }
  return { article, sourceId };
}

/** Remove a committed test Article (cascades enrichments) and its Source. */
async function cleanup(articleId: string, sourceId: string): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM articles WHERE id = $1', [articleId]);
  await pool.query('DELETE FROM sources WHERE id = $1', [sourceId]);
}

async function countRows(db: Db, table: string): Promise<number> {
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${table}`,
  );
  return Number(result.rows[0]?.count ?? '0');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(!hasDb)('enrichArticle (integration)', () => {
  beforeAll(async () => {
    await migrate();
  });
  afterAll(async () => {
    await closePool();
  });

  it('persists a SUCCEEDED, validated enrichment as version 1', async () => {
    const { article, sourceId } = await seedArticle();
    try {
      const provider = new FakeProvider({ respondWith: VALID_OUTPUT });
      const result = await enrichArticle(provider, article.id);

      expect(result.outcome).toBe('SUCCEEDED');
      expect(result.enrichment.enrichment_version).toBe(1);
      expect(result.enrichment.status).toBe('SUCCEEDED');
      expect(result.enrichment.relevance).toBe('RELEVANT');
      expect(result.enrichment.summary).toContain('coding agent');
      expect(result.enrichment.confidence).toBeCloseTo(0.87);
      expect(result.enrichment.model_provider).toBe('fake');
      expect(result.enrichment.suggested_topics).toHaveLength(2);
      expect(result.enrichment.structured_output).not.toBeNull();
    } finally {
      await cleanup(article.id, sourceId);
    }
  });

  it('never modifies Article source facts', async () => {
    const { article, sourceId } = await seedArticle();
    try {
      const provider = new FakeProvider({ respondWith: VALID_OUTPUT });
      await enrichArticle(provider, article.id);

      const after = await new ArticleRepository(getPool()).findById(article.id);
      expect(after?.original_title).toBe(article.original_title);
      expect(after?.original_excerpt).toBe(article.original_excerpt);
      expect(after?.status).toBe(article.status);
      expect(String(after?.updated_at)).toBe(String(article.updated_at));
    } finally {
      await cleanup(article.id, sourceId);
    }
  });

  it('re-running creates a new version and preserves the prior one', async () => {
    const { article, sourceId } = await seedArticle();
    try {
      const provider = new FakeProvider({ respondWith: VALID_OUTPUT });
      const first = await enrichArticle(provider, article.id);
      const second = await enrichArticle(provider, article.id);
      expect(first.enrichment.enrichment_version).toBe(1);
      expect(second.enrichment.enrichment_version).toBe(2);

      const repo = new ArticleEnrichmentRepository(getPool());
      const history = await repo.listByArticle(article.id);
      expect(history).toHaveLength(2);
      expect(history[0]?.enrichment_version).toBe(2);
      expect((await repo.findLatest(article.id))?.enrichment_version).toBe(2);
    } finally {
      await cleanup(article.id, sourceId);
    }
  });

  it('records INVALID_OUTPUT for a malformed reply and keeps the raw output', async () => {
    const { article, sourceId } = await seedArticle();
    try {
      const provider = new FakeProvider({
        respondWith: { relevance: 'RELEVANT' }, // missing required fields
      });
      const result = await enrichArticle(provider, article.id);

      expect(result.outcome).toBe('INVALID_OUTPUT');
      expect(result.enrichment.status).toBe('INVALID_OUTPUT');
      expect(result.enrichment.relevance).toBe('UNCLASSIFIED');
      expect(result.enrichment.validation_error).toBeTruthy();
      expect(result.enrichment.structured_output).toEqual({
        relevance: 'RELEVANT',
      });

      const after = await new ArticleRepository(getPool()).findById(article.id);
      expect(after?.original_title).toBe(article.original_title);
    } finally {
      await cleanup(article.id, sourceId);
    }
  });

  it('records a PROVIDER_ERROR with retryable classification', async () => {
    const { article, sourceId } = await seedArticle();
    try {
      const provider = new FakeProvider({
        failWith: new AiProviderError('RATE_LIMITED', 'slow down'),
      });
      const result = await enrichArticle(provider, article.id);

      expect(result.outcome).toBe('PROVIDER_ERROR');
      if (result.outcome === 'PROVIDER_ERROR') {
        expect(result.retryable).toBe(true);
        expect(result.errorCode).toBe('RATE_LIMITED');
      }
      expect(result.enrichment.status).toBe('PROVIDER_ERROR');
      expect(result.enrichment.relevance).toBe('UNCLASSIFIED');
      expect(result.enrichment.error_code).toBe('RATE_LIMITED');
    } finally {
      await cleanup(article.id, sourceId);
    }
  });

  it('classifies a non-retryable provider error', async () => {
    const { article, sourceId } = await seedArticle();
    try {
      const provider = new FakeProvider({
        failWith: new AiProviderError('AUTH', 'bad key'),
      });
      const result = await enrichArticle(provider, article.id);
      if (result.outcome !== 'PROVIDER_ERROR')
        throw new Error('expected PROVIDER_ERROR');
      expect(result.retryable).toBe(false);
      expect(result.errorCode).toBe('AUTH');
    } finally {
      await cleanup(article.id, sourceId);
    }
  });

  it('throws for a missing Article and writes nothing', async () => {
    const provider = new FakeProvider({ respondWith: VALID_OUTPUT });
    await expect(
      enrichArticle(provider, crypto.randomUUID()),
    ).rejects.toBeInstanceOf(ArticleNotFoundError);
  });

  it('refuses ineligible Articles unless forced', async () => {
    const { article, sourceId } = await seedArticle({ status: 'HIDDEN' });
    try {
      const provider = new FakeProvider({ respondWith: VALID_OUTPUT });
      await expect(enrichArticle(provider, article.id)).rejects.toBeInstanceOf(
        EnrichmentIneligibleError,
      );
      expect(provider.calls).toHaveLength(0);

      const forced = await enrichArticle(provider, article.id, { force: true });
      expect(forced.outcome).toBe('SUCCEEDED');
    } finally {
      await cleanup(article.id, sourceId);
    }
  });

  it('resolves suggestions without creating canonical records', async () => {
    const { article, sourceId } = await seedArticle();
    const suffix = crypto.randomUUID().slice(0, 8);
    const topicSlug = `agents-${suffix}`;
    const entityName = `Match Tool ${suffix}`;
    const entitySlug = `match-tool-${suffix}`;
    const pool = getPool();
    try {
      // Create the matching Topic as a CHILD of an existing top-level Topic —
      // never a new top-level one — so the global "exactly 12 top-level Topics"
      // invariant asserted by other (concurrently-running) integration test files
      // is not disturbed. Suggestion matching is by slug, independent of parent.
      const parent = await pool.query<{ id: string }>(
        'SELECT id FROM topics WHERE parent_id IS NULL ORDER BY slug LIMIT 1',
      );
      await new TopicRepository(pool).create({
        name: `Agents ${suffix}`,
        slug: topicSlug,
        parentId: parent.rows[0]!.id,
      });
      await new EntityRepository(pool).create({
        entityType: 'PRODUCT',
        name: entityName,
        slug: entitySlug,
      });

      const topicsBefore = await countRows(pool, 'topics');
      const entitiesBefore = await countRows(pool, 'entities');
      const aliasesBefore = await countRows(pool, 'entity_aliases');

      const provider = new FakeProvider({
        respondWith: {
          relevance: 'RELEVANT',
          relevanceReason: 'About a coding agent.',
          summary: 'Summary.',
          whyItMatters: 'Matters.',
          suggestedTopics: [
            { name: `Agents ${suffix}`, slug: topicSlug },
            { name: 'Totally Made Up Topic' },
          ],
          suggestedEntities: [
            { name: entityName, type: 'PRODUCT' },
            { name: 'Nonexistent Tool 9000' },
          ],
          confidence: 0.8,
        },
      });
      const result = await enrichArticle(provider, article.id);
      if (result.outcome !== 'SUCCEEDED') throw new Error('expected success');

      const resolved = await resolveSuggestions(
        pool,
        result.enrichment.suggested_topics,
        result.enrichment.suggested_entities,
      );
      expect(resolved.matchedTopics.map((m) => m.topic.slug)).toEqual([
        topicSlug,
      ]);
      expect(resolved.unresolvedTopics.map((t) => t.name)).toEqual([
        'Totally Made Up Topic',
      ]);
      expect(resolved.matchedEntities.map((m) => m.entity.slug)).toEqual([
        entitySlug,
      ]);
      expect(resolved.unresolvedEntities.map((e) => e.name)).toEqual([
        'Nonexistent Tool 9000',
      ]);

      // No canonical record was created by suggestion/resolution.
      expect(await countRows(pool, 'topics')).toBe(topicsBefore);
      expect(await countRows(pool, 'entities')).toBe(entitiesBefore);
      expect(await countRows(pool, 'entity_aliases')).toBe(aliasesBefore);
    } finally {
      await pool.query('DELETE FROM topics WHERE slug = $1', [topicSlug]);
      await pool.query('DELETE FROM entities WHERE slug = $1', [entitySlug]);
      await cleanup(article.id, sourceId);
    }
  });

  // --- Concurrency, exercised through the NORMAL public path with NO
  // caller-managed transactions (the repository owns its own).

  it('allocates distinct, contiguous versions under concurrent same-Article writes', async () => {
    const { article, sourceId } = await seedArticle();
    try {
      const provider = new FakeProvider({ respondWith: VALID_OUTPUT });
      const N = 8;

      // Fire N enrichments at once — no transaction handling by the caller.
      const results = await Promise.all(
        Array.from({ length: N }, () => enrichArticle(provider, article.id)),
      );

      // All concurrent attempts succeed — none is lost to a version collision.
      expect(results.map((r) => r.outcome)).toEqual(
        Array.from({ length: N }, () => 'SUCCEEDED'),
      );

      // Versions are distinct and form a continuous monotonic sequence 1..N.
      const versions = results
        .map((r) => r.enrichment.enrichment_version)
        .sort((a, b) => a - b);
      expect(versions).toEqual(Array.from({ length: N }, (_, i) => i + 1));

      // Every row is persisted; prior history preserved (nothing overwritten).
      const rows = await new ArticleEnrichmentRepository(
        getPool(),
      ).listByArticle(article.id, 100);
      expect(rows).toHaveLength(N);
      expect(new Set(rows.map((r) => r.enrichment_version)).size).toBe(N);
    } finally {
      await cleanup(article.id, sourceId);
    }
  });

  it('does not serialize enrichment for different Articles', async () => {
    const a = await seedArticle();
    const b = await seedArticle();
    const provider = new FakeProvider({ respondWith: VALID_OUTPUT });
    const lockClient = await getPool().connect();
    try {
      // Hold Article A's version-allocation lock in a separate transaction,
      // using the exact same key the repository computes.
      await lockClient.query('BEGIN');
      await lockClient.query(
        'SELECT pg_advisory_xact_lock($1, hashtext($2::text))',
        [ENRICHMENT_LOCK_NAMESPACE, a.article.id],
      );

      // Article B hashes to a different key: it must complete without blocking.
      const bResult = await enrichArticle(provider, b.article.id);
      expect(bResult.outcome).toBe('SUCCEEDED');

      // Article A must block while its lock is held elsewhere.
      const aPromise = enrichArticle(provider, a.article.id);
      const raced = await Promise.race([
        aPromise.then(() => 'resolved' as const),
        delay(300).then(() => 'pending' as const),
      ]);
      expect(raced).toBe('pending');

      // Release the lock; Article A now proceeds and gets version 1.
      await lockClient.query('ROLLBACK');
      const aResult = await aPromise;
      expect(aResult.outcome).toBe('SUCCEEDED');
      expect(aResult.enrichment.enrichment_version).toBe(1);
    } finally {
      lockClient.release();
      await cleanup(a.article.id, a.sourceId);
      await cleanup(b.article.id, b.sourceId);
    }
  });
});
