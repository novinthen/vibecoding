import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AiProviderError } from '@/ai/provider/errors';
import { FakeProvider } from '@/ai/provider/fake-provider';
import { UnauthorizedError } from '@/admin/auth/guard';
import type { AdminSession } from '@/admin/auth/session';
import {
  getArticleEnrichmentReview,
  triggerArticleEnrichment,
} from '@/admin/services/enrichment-service';
import { NotFoundError } from '@/admin/errors';
import { closePool, getPool, type Db } from '@/db/client';
import { migrate } from '@/db/migrate';
import { AdminAuditLogRepository, ArticleRepository } from '@/domain';
import type { ArticleRow } from '@/domain/types';

/**
 * Admin enrichment workflow integration tests (real Postgres, DATABASE_URL-gated).
 *
 * Prove authorization around the trigger, the audit record, and the read-only
 * review assembly. Each test runs in a rolled-back transaction.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

const ADMIN: AdminSession = {
  username: 'alice',
  role: 'ADMIN',
  iat: 0,
  exp: 9e9,
};
const VIEWER: AdminSession = {
  username: 'val',
  role: 'VIEWER',
  iat: 0,
  exp: 9e9,
};

const VALID_OUTPUT = {
  relevance: 'MAYBE_RELEVANT',
  relevanceReason: 'Adjacent to the domain.',
  summary: 'Summary text.',
  whyItMatters: 'Matters because.',
  suggestedTopics: [],
  suggestedEntities: [],
  confidence: 0.5,
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

async function seedArticle(tx: Db): Promise<ArticleRow> {
  const source = await tx.query<{ id: string }>(
    `INSERT INTO sources (name, slug, source_type, authority_tier)
     VALUES ('S', 'admin-enrich-' || gen_random_uuid(), 'RSS', 'TRUSTED')
     RETURNING id`,
  );
  return new ArticleRepository(tx).create({
    sourceId: source.rows[0]!.id,
    url: `https://example.com/${crypto.randomUUID()}`,
    originalTitle: 'A coding agent update',
  });
}

describe.skipIf(!hasDb)('admin enrichment (integration)', () => {
  beforeAll(async () => {
    await migrate();
  });
  afterAll(async () => {
    await closePool();
  });

  it('refuses a VIEWER and writes no enrichment or audit', async () => {
    await inRollbackTx(async (tx) => {
      const article = await seedArticle(tx);
      const provider = new FakeProvider({ respondWith: VALID_OUTPUT });

      await expect(
        triggerArticleEnrichment(tx, VIEWER, provider, article.id),
      ).rejects.toBeInstanceOf(UnauthorizedError);
      expect(provider.calls).toHaveLength(0);

      const review = await getArticleEnrichmentReview(tx, article.id);
      expect(review.latest).toBeNull();
      const audit = await new AdminAuditLogRepository(tx).listRecent({
        targetType: 'article',
        targetId: article.id,
      });
      expect(audit).toHaveLength(0);
    });
  });

  it('lets an ADMIN trigger enrichment and writes an audit record', async () => {
    await inRollbackTx(async (tx) => {
      const article = await seedArticle(tx);
      const provider = new FakeProvider({ respondWith: VALID_OUTPUT });

      const result = await triggerArticleEnrichment(
        tx,
        ADMIN,
        provider,
        article.id,
      );
      expect(result.outcome).toBe('SUCCEEDED');

      const audit = await new AdminAuditLogRepository(tx).listRecent({
        targetType: 'article',
        targetId: article.id,
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]?.action).toBe('ARTICLE_ENRICHMENT_TRIGGER');
      expect(audit[0]?.actor_identifier).toBe('alice');
      expect((audit[0]?.metadata as { outcome?: string }).outcome).toBe(
        'SUCCEEDED',
      );
    });
  });

  it('records an audit row even when the provider fails', async () => {
    await inRollbackTx(async (tx) => {
      const article = await seedArticle(tx);
      const provider = new FakeProvider({
        failWith: new AiProviderError('SERVER', 'upstream down'),
      });

      const result = await triggerArticleEnrichment(
        tx,
        ADMIN,
        provider,
        article.id,
      );
      expect(result.outcome).toBe('PROVIDER_ERROR');

      const audit = await new AdminAuditLogRepository(tx).listRecent({
        targetType: 'article',
        targetId: article.id,
      });
      expect(audit).toHaveLength(1);
      expect((audit[0]?.metadata as { outcome?: string }).outcome).toBe(
        'PROVIDER_ERROR',
      );
    });
  });

  it('maps a missing Article to NotFoundError', async () => {
    await inRollbackTx(async (tx) => {
      const provider = new FakeProvider({ respondWith: VALID_OUTPUT });
      await expect(
        triggerArticleEnrichment(tx, ADMIN, provider, crypto.randomUUID()),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  it('assembles the review with latest, history, and suggestions', async () => {
    await inRollbackTx(async (tx) => {
      const article = await seedArticle(tx);
      const provider = new FakeProvider({ respondWith: VALID_OUTPUT });
      await triggerArticleEnrichment(tx, ADMIN, provider, article.id);
      await triggerArticleEnrichment(tx, ADMIN, provider, article.id);

      const review = await getArticleEnrichmentReview(tx, article.id);
      expect(review.latest?.enrichment_version).toBe(2);
      expect(review.history).toHaveLength(2);
      expect(review.suggestions).not.toBeNull();
    });
  });
});
