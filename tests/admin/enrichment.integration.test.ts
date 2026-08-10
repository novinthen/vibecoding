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
 * These call the NORMAL public path — `triggerArticleEnrichment(actor, provider,
 * articleId, ...)` — with NO caller-managed transaction. The service performs the
 * AI call first, then persists the enrichment AND its audit row atomically in the
 * repository's own short transaction. Because the path commits, each test cleans
 * up (deleting the Article cascades its enrichments; audit rows carry no FK, so
 * they are removed explicitly by target).
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

async function seedArticle(): Promise<{
  article: ArticleRow;
  sourceId: string;
}> {
  const pool = getPool();
  const source = await pool.query<{ id: string }>(
    `INSERT INTO sources (name, slug, source_type, authority_tier)
     VALUES ('S', 'admin-enrich-' || gen_random_uuid(), 'RSS', 'TRUSTED')
     RETURNING id`,
  );
  const sourceId = source.rows[0]!.id;
  const article = await new ArticleRepository(pool).create({
    sourceId,
    url: `https://example.com/${crypto.randomUUID()}`,
    originalTitle: 'A coding agent update',
  });
  return { article, sourceId };
}

async function cleanup(articleId: string, sourceId: string): Promise<void> {
  const pool = getPool();
  // Audit rows have no FK to the article (polymorphic target) — remove by target.
  await pool.query(
    `DELETE FROM admin_audit_log WHERE target_type = 'article' AND target_id = $1`,
    [articleId],
  );
  await pool.query('DELETE FROM articles WHERE id = $1', [articleId]);
  await pool.query('DELETE FROM sources WHERE id = $1', [sourceId]);
}

function auditFor(db: Db, articleId: string) {
  return new AdminAuditLogRepository(db).listRecent({
    targetType: 'article',
    targetId: articleId,
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
    const { article, sourceId } = await seedArticle();
    try {
      const provider = new FakeProvider({ respondWith: VALID_OUTPUT });
      await expect(
        triggerArticleEnrichment(VIEWER, provider, article.id),
      ).rejects.toBeInstanceOf(UnauthorizedError);
      expect(provider.calls).toHaveLength(0);

      const review = await getArticleEnrichmentReview(getPool(), article.id);
      expect(review.latest).toBeNull();
      expect(await auditFor(getPool(), article.id)).toHaveLength(0);
    } finally {
      await cleanup(article.id, sourceId);
    }
  });

  it('lets an ADMIN trigger enrichment and writes the audit atomically', async () => {
    const { article, sourceId } = await seedArticle();
    try {
      const provider = new FakeProvider({ respondWith: VALID_OUTPUT });
      const result = await triggerArticleEnrichment(
        ADMIN,
        provider,
        article.id,
      );
      expect(result.outcome).toBe('SUCCEEDED');

      const audit = await auditFor(getPool(), article.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.action).toBe('ARTICLE_ENRICHMENT_TRIGGER');
      expect(audit[0]?.actor_identifier).toBe('alice');
      expect((audit[0]?.metadata as { outcome?: string }).outcome).toBe(
        'SUCCEEDED',
      );
      expect(
        (audit[0]?.metadata as { enrichment_version?: number })
          .enrichment_version,
      ).toBe(1);
    } finally {
      await cleanup(article.id, sourceId);
    }
  });

  it('records an audit row even when the provider fails', async () => {
    const { article, sourceId } = await seedArticle();
    try {
      const provider = new FakeProvider({
        failWith: new AiProviderError('SERVER', 'upstream down'),
      });
      const result = await triggerArticleEnrichment(
        ADMIN,
        provider,
        article.id,
      );
      expect(result.outcome).toBe('PROVIDER_ERROR');

      const audit = await auditFor(getPool(), article.id);
      expect(audit).toHaveLength(1);
      expect((audit[0]?.metadata as { outcome?: string }).outcome).toBe(
        'PROVIDER_ERROR',
      );
    } finally {
      await cleanup(article.id, sourceId);
    }
  });

  it('maps a missing Article to NotFoundError', async () => {
    const provider = new FakeProvider({ respondWith: VALID_OUTPUT });
    await expect(
      triggerArticleEnrichment(ADMIN, provider, crypto.randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('assembles the review with latest, history, and suggestions', async () => {
    const { article, sourceId } = await seedArticle();
    try {
      const provider = new FakeProvider({ respondWith: VALID_OUTPUT });
      await triggerArticleEnrichment(ADMIN, provider, article.id);
      await triggerArticleEnrichment(ADMIN, provider, article.id);

      const review = await getArticleEnrichmentReview(getPool(), article.id);
      expect(review.latest?.enrichment_version).toBe(2);
      expect(review.history).toHaveLength(2);
      expect(review.suggestions).not.toBeNull();

      // Two triggers => two audit rows, committed atomically with their versions.
      expect(await auditFor(getPool(), article.id)).toHaveLength(2);
    } finally {
      await cleanup(article.id, sourceId);
    }
  });
});
