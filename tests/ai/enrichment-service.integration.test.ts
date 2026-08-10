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
import type { ArticleRow } from '@/domain/types';

/**
 * Enrichment service integration tests (real Postgres, DATABASE_URL-gated).
 *
 * Each test runs in a rolled-back transaction. They prove the Stage 6 invariants
 * end-to-end: source facts are never modified, every attempt is versioned, invalid
 * and provider-failed attempts are recorded, and suggestions never silently become
 * canonical records.
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

async function inRollbackTx<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function seedArticle(
  tx: Db,
  overrides: Partial<{ status: string; title: string; excerpt: string }> = {},
): Promise<ArticleRow> {
  const source = await tx.query<{ id: string }>(
    `INSERT INTO sources (name, slug, source_type, authority_tier)
     VALUES ('S', 'enrich-src-' || gen_random_uuid(), 'RSS', 'TRUSTED')
     RETURNING id`,
  );
  const sourceId = source.rows[0]!.id;
  const article = await new ArticleRepository(tx).create({
    sourceId,
    url: `https://example.com/${crypto.randomUUID()}`,
    originalTitle: overrides.title ?? 'A new coding agent',
    originalExcerpt: overrides.excerpt ?? 'It writes code for you.',
  });
  if (overrides.status) {
    await tx.query('UPDATE articles SET status = $2 WHERE id = $1', [
      article.id,
      overrides.status,
    ]);
    return { ...article, status: overrides.status as ArticleRow['status'] };
  }
  return article;
}

describe.skipIf(!hasDb)('enrichArticle (integration)', () => {
  beforeAll(async () => {
    await migrate();
  });
  afterAll(async () => {
    await closePool();
  });

  it('persists a SUCCEEDED, validated enrichment as version 1', async () => {
    await inRollbackTx(async (tx) => {
      const article = await seedArticle(tx);
      const provider = new FakeProvider({ respondWith: VALID_OUTPUT });

      const result = await enrichArticle(tx, provider, article.id);
      expect(result.outcome).toBe('SUCCEEDED');
      expect(result.enrichment.enrichment_version).toBe(1);
      expect(result.enrichment.status).toBe('SUCCEEDED');
      expect(result.enrichment.relevance).toBe('RELEVANT');
      expect(result.enrichment.summary).toContain('coding agent');
      expect(result.enrichment.confidence).toBeCloseTo(0.87);
      expect(result.enrichment.model_provider).toBe('fake');
      expect(result.enrichment.suggested_topics).toHaveLength(2);
      expect(result.enrichment.structured_output).not.toBeNull();
    });
  });

  it('never modifies Article source facts', async () => {
    await inRollbackTx(async (tx) => {
      const article = await seedArticle(tx);
      const provider = new FakeProvider({ respondWith: VALID_OUTPUT });
      await enrichArticle(tx, provider, article.id);

      const after = await new ArticleRepository(tx).findById(article.id);
      expect(after?.original_title).toBe(article.original_title);
      expect(after?.original_excerpt).toBe(article.original_excerpt);
      expect(after?.status).toBe(article.status);
      // `updated_at` (a timestamptz) must be unchanged by enrichment.
      expect(String(after?.updated_at)).toBe(String(article.updated_at));
    });
  });

  it('re-running creates a new version and preserves the prior one', async () => {
    await inRollbackTx(async (tx) => {
      const article = await seedArticle(tx);
      const provider = new FakeProvider({ respondWith: VALID_OUTPUT });

      const first = await enrichArticle(tx, provider, article.id);
      const second = await enrichArticle(tx, provider, article.id);
      expect(first.enrichment.enrichment_version).toBe(1);
      expect(second.enrichment.enrichment_version).toBe(2);

      const history = await new ArticleEnrichmentRepository(tx).listByArticle(
        article.id,
      );
      expect(history).toHaveLength(2);
      expect(history[0]?.enrichment_version).toBe(2);
      const latest = await new ArticleEnrichmentRepository(tx).findLatest(
        article.id,
      );
      expect(latest?.enrichment_version).toBe(2);
    });
  });

  it('records INVALID_OUTPUT for a malformed reply and keeps the raw output', async () => {
    await inRollbackTx(async (tx) => {
      const article = await seedArticle(tx);
      const provider = new FakeProvider({
        respondWith: { relevance: 'RELEVANT' }, // missing required fields
      });

      const result = await enrichArticle(tx, provider, article.id);
      expect(result.outcome).toBe('INVALID_OUTPUT');
      expect(result.enrichment.status).toBe('INVALID_OUTPUT');
      expect(result.enrichment.relevance).toBe('UNCLASSIFIED');
      expect(result.enrichment.validation_error).toBeTruthy();
      // Raw parsed output retained for debugging/audit.
      expect(result.enrichment.structured_output).toEqual({
        relevance: 'RELEVANT',
      });
      // Article untouched.
      const after = await new ArticleRepository(tx).findById(article.id);
      expect(after?.original_title).toBe(article.original_title);
    });
  });

  it('records a PROVIDER_ERROR with retryable classification', async () => {
    await inRollbackTx(async (tx) => {
      const article = await seedArticle(tx);
      const provider = new FakeProvider({
        failWith: new AiProviderError('RATE_LIMITED', 'slow down'),
      });

      const result = await enrichArticle(tx, provider, article.id);
      expect(result.outcome).toBe('PROVIDER_ERROR');
      if (result.outcome === 'PROVIDER_ERROR') {
        expect(result.retryable).toBe(true);
        expect(result.errorCode).toBe('RATE_LIMITED');
      }
      expect(result.enrichment.status).toBe('PROVIDER_ERROR');
      expect(result.enrichment.relevance).toBe('UNCLASSIFIED');
      expect(result.enrichment.error_code).toBe('RATE_LIMITED');
    });
  });

  it('classifies a non-retryable provider error', async () => {
    await inRollbackTx(async (tx) => {
      const article = await seedArticle(tx);
      const provider = new FakeProvider({
        failWith: new AiProviderError('AUTH', 'bad key'),
      });
      const result = await enrichArticle(tx, provider, article.id);
      if (result.outcome === 'PROVIDER_ERROR') {
        expect(result.retryable).toBe(false);
        expect(result.errorCode).toBe('AUTH');
      } else {
        throw new Error('expected PROVIDER_ERROR');
      }
    });
  });

  it('throws for a missing Article and writes nothing', async () => {
    await inRollbackTx(async (tx) => {
      const provider = new FakeProvider({ respondWith: VALID_OUTPUT });
      await expect(
        enrichArticle(tx, provider, crypto.randomUUID()),
      ).rejects.toBeInstanceOf(ArticleNotFoundError);
    });
  });

  it('refuses ineligible Articles unless forced', async () => {
    await inRollbackTx(async (tx) => {
      const article = await seedArticle(tx, { status: 'HIDDEN' });
      const provider = new FakeProvider({ respondWith: VALID_OUTPUT });

      await expect(
        enrichArticle(tx, provider, article.id),
      ).rejects.toBeInstanceOf(EnrichmentIneligibleError);
      expect(provider.calls).toHaveLength(0);

      const forced = await enrichArticle(tx, provider, article.id, {
        force: true,
      });
      expect(forced.outcome).toBe('SUCCEEDED');
    });
  });

  it('resolves suggestions without creating canonical records', async () => {
    await inRollbackTx(async (tx) => {
      const article = await seedArticle(tx);
      // Use unique slugs so the test does not collide with seeded taxonomy.
      const suffix = crypto.randomUUID().slice(0, 8);
      const topicSlug = `agents-${suffix}`;
      const entityName = `Match Tool ${suffix}`;
      const entitySlug = `match-tool-${suffix}`;

      await new TopicRepository(tx).create({
        name: `Agents ${suffix}`,
        slug: topicSlug,
        parentId: null as unknown as string,
      });
      await new EntityRepository(tx).create({
        entityType: 'PRODUCT',
        name: entityName,
        slug: entitySlug,
      });

      const topicsBefore = await countRows(tx, 'topics');
      const entitiesBefore = await countRows(tx, 'entities');
      const aliasesBefore = await countRows(tx, 'entity_aliases');

      // One matching + one hallucinated suggestion of each kind.
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
      const result = await enrichArticle(tx, provider, article.id);
      if (result.outcome !== 'SUCCEEDED') throw new Error('expected success');

      const resolved = await resolveSuggestions(
        tx,
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
      expect(await countRows(tx, 'topics')).toBe(topicsBefore);
      expect(await countRows(tx, 'entities')).toBe(entitiesBefore);
      expect(await countRows(tx, 'entity_aliases')).toBe(aliasesBefore);
    });
  });
});

async function countRows(tx: Db, table: string): Promise<number> {
  const result = await tx.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${table}`,
  );
  return Number(result.rows[0]?.count ?? '0');
}
