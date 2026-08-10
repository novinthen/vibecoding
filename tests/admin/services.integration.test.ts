import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UnauthorizedError } from '@/admin/auth/guard';
import type { AdminSession } from '@/admin/auth/session';
import { AdminValidationError } from '@/admin/errors';
import { updateArticleStatus } from '@/admin/services/article-service';
import {
  createSource,
  setSourceEnabled,
  triggerSourceIngestion,
  updateSource,
} from '@/admin/services/source-service';
import { createTopic } from '@/admin/services/topic-service';
import { closePool, getPool, type Db } from '@/db/client';
import { migrate } from '@/db/migrate';
import {
  AdminAuditLogRepository,
  ArticleRepository,
  SourceFetchRepository,
  SourceRepository,
} from '@/domain';
import type { FeedFetcher, FeedResponse } from '@/ingestion';

import { loadFixture } from '../ingestion/fixtures';

/**
 * Admin service integration tests (real Postgres, DATABASE_URL-gated).
 *
 * Every test body runs inside a transaction that is always rolled back, so no
 * state leaks. These cover the Stage 4 mutation guarantees end-to-end against
 * the schema: authorization, validation, the actual write, and — critically —
 * that each meaningful mutation produces an AdminAuditLog record.
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

function auditCount(tx: Db, action: string): Promise<number> {
  return tx
    .query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM admin_audit_log WHERE action = $1',
      [action],
    )
    .then((r) => Number(r.rows[0]?.count ?? '0'));
}

function fixtureFetcher(name: string): FeedFetcher {
  return () =>
    Promise.resolve<FeedResponse>({
      status: 200,
      notModified: false,
      body: loadFixture(name),
      etag: null,
      lastModified: null,
      contentType: 'application/xml',
      finalUrl: 'https://example.com/feed',
    });
}

const baseSource = {
  name: 'Example Source',
  sourceType: 'RSS' as const,
  authorityTier: 'TRUSTED' as const,
  feedUrl: 'https://example.com/feed.xml',
};

describe.skipIf(!hasDb)('admin services (integration)', () => {
  beforeAll(async () => {
    await migrate();
  });

  afterAll(async () => {
    await closePool();
  });

  describe('source management + audit', () => {
    it('creates a Source and writes a SOURCE_CREATE audit record', async () => {
      await inRollbackTx(async (tx) => {
        const created = await createSource(tx, ADMIN, {
          ...baseSource,
          slug: 'example-create',
        });
        expect(created.slug).toBe('example-create');
        expect(created.source_type).toBe('RSS');

        const audit = await new AdminAuditLogRepository(tx).listRecent({
          targetType: 'source',
          targetId: created.id,
        });
        expect(audit).toHaveLength(1);
        expect(audit[0]?.action).toBe('SOURCE_CREATE');
        expect(audit[0]?.actor_identifier).toBe('alice');
        expect((audit[0]?.after as { slug?: string })?.slug).toBe(
          'example-create',
        );
      });
    });

    it('rejects a duplicate slug and writes no audit for the failure', async () => {
      await inRollbackTx(async (tx) => {
        await createSource(tx, ADMIN, { ...baseSource, slug: 'dup-slug' });
        await expect(
          createSource(tx, ADMIN, { ...baseSource, slug: 'dup-slug' }),
        ).rejects.toBeInstanceOf(AdminValidationError);
        // Only the first create audited.
        expect(await auditCount(tx, 'SOURCE_CREATE')).toBe(1);
      });
    });

    it('rejects invalid input (Zod) with no write', async () => {
      await inRollbackTx(async (tx) => {
        await expect(
          createSource(tx, ADMIN, {
            name: '',
            sourceType: 'RSS',
            authorityTier: 'TRUSTED',
          }),
        ).rejects.toBeTruthy();
        expect(await auditCount(tx, 'SOURCE_CREATE')).toBe(0);
      });
    });

    it('rejects a VIEWER mutation with no write (server-side authorization)', async () => {
      await inRollbackTx(async (tx) => {
        await expect(
          createSource(tx, VIEWER, { ...baseSource, slug: 'viewer-denied' }),
        ).rejects.toBeInstanceOf(UnauthorizedError);
        const found = await new SourceRepository(tx).findBySlug(
          'viewer-denied',
        );
        expect(found).toBeNull();
        expect(await auditCount(tx, 'SOURCE_CREATE')).toBe(0);
      });
    });

    it('edits permitted fields and audits before/after', async () => {
      await inRollbackTx(async (tx) => {
        const created = await createSource(tx, ADMIN, {
          ...baseSource,
          slug: 'edit-me',
        });
        const updated = await updateSource(tx, ADMIN, created.id, {
          name: 'Renamed Source',
          authorityTier: 'PRIMARY',
          feedUrl: 'https://example.com/new.xml',
        });
        expect(updated.name).toBe('Renamed Source');
        expect(updated.authority_tier).toBe('PRIMARY');
        // slug is immutable — unchanged.
        expect(updated.slug).toBe('edit-me');

        const audit = await new AdminAuditLogRepository(tx).listRecent({
          targetType: 'source',
          targetId: created.id,
        });
        const update = audit.find((a) => a.action === 'SOURCE_UPDATE');
        expect(update).toBeTruthy();
        expect((update?.before as { name?: string })?.name).toBe(
          'Example Source',
        );
        expect((update?.after as { name?: string })?.name).toBe(
          'Renamed Source',
        );
      });
    });

    it('disables a Source, sets health DISABLED, and audits', async () => {
      await inRollbackTx(async (tx) => {
        const created = await createSource(tx, ADMIN, {
          ...baseSource,
          slug: 'toggle-me',
        });
        const disabled = await setSourceEnabled(tx, ADMIN, created.id, false);
        expect(disabled.enabled).toBe(false);
        expect(disabled.health_status).toBe('DISABLED');

        const reEnabled = await setSourceEnabled(tx, ADMIN, created.id, true);
        expect(reEnabled.enabled).toBe(true);
        expect(reEnabled.health_status).toBe('UNKNOWN');

        expect(await auditCount(tx, 'SOURCE_DISABLE')).toBe(1);
        expect(await auditCount(tx, 'SOURCE_ENABLE')).toBe(1);
      });
    });
  });

  describe('manual ingestion delegation', () => {
    it('delegates to the Stage 3 engine, persists Articles, and audits', async () => {
      await inRollbackTx(async (tx) => {
        const created = await createSource(tx, ADMIN, {
          ...baseSource,
          slug: 'ingest-me',
        });

        const { result } = await triggerSourceIngestion(tx, ADMIN, created.id, {
          fetchFeed: fixtureFetcher('rss-basic.xml'),
        });
        expect(result.status).toBe('SUCCESS');
        expect(result.itemsNew).toBeGreaterThan(0);

        // Articles were written through the real repository.
        const articles = await new ArticleRepository(tx).listBySource(
          created.id,
        );
        expect(articles.length).toBeGreaterThan(0);

        // A SourceFetch audit row exists for the attempt.
        const fetches = await new SourceFetchRepository(tx).listRecent(
          created.id,
        );
        expect(fetches.length).toBeGreaterThan(0);

        // And an AdminAuditLog entry records who triggered it + the outcome.
        const audit = await new AdminAuditLogRepository(tx).listRecent({
          targetType: 'source',
          targetId: created.id,
        });
        const manual = audit.find((a) => a.action === 'SOURCE_INGEST_MANUAL');
        expect(manual).toBeTruthy();
        expect((manual?.metadata as { status?: string })?.status).toBe(
          'SUCCESS',
        );
      });
    });

    it('rejects a VIEWER-triggered ingestion', async () => {
      await inRollbackTx(async (tx) => {
        const created = await createSource(tx, ADMIN, {
          ...baseSource,
          slug: 'ingest-denied',
        });
        await expect(
          triggerSourceIngestion(tx, VIEWER, created.id, {
            fetchFeed: fixtureFetcher('rss-basic.xml'),
          }),
        ).rejects.toBeInstanceOf(UnauthorizedError);
      });
    });
  });

  describe('article editorial + inspection', () => {
    async function seedArticle(
      tx: Db,
      overrides: { title?: string; status?: string; urlHash?: string } = {},
    ): Promise<{ sourceId: string; articleId: string }> {
      const source = await createSource(tx, ADMIN, {
        ...baseSource,
        slug: `art-src-${overrides.urlHash ?? 'a'}`,
      });
      const article = await new ArticleRepository(tx).create({
        sourceId: source.id,
        url: `https://example.com/${overrides.urlHash ?? 'a'}`,
        originalTitle: overrides.title ?? 'Original Title',
        urlHash: overrides.urlHash ?? 'hash-a',
      });
      if (overrides.status) {
        await tx.query('UPDATE articles SET status = $2 WHERE id = $1', [
          article.id,
          overrides.status,
        ]);
      }
      return { sourceId: source.id, articleId: article.id };
    }

    it('changes status, audits, and preserves source facts', async () => {
      await inRollbackTx(async (tx) => {
        const { articleId } = await seedArticle(tx, { title: 'Keep Me' });
        const updated = await updateArticleStatus(tx, ADMIN, articleId, {
          status: 'HIDDEN',
        });
        expect(updated.status).toBe('HIDDEN');
        // Provenance: the source-supplied title is untouched.
        expect(updated.original_title).toBe('Keep Me');

        const audit = await new AdminAuditLogRepository(tx).listRecent({
          targetType: 'article',
          targetId: articleId,
        });
        expect(audit[0]?.action).toBe('ARTICLE_STATUS_CHANGE');
        expect((audit[0]?.metadata as { to?: string })?.to).toBe('HIDDEN');
      });
    });

    it('rejects an invalid status change', async () => {
      await inRollbackTx(async (tx) => {
        const { articleId } = await seedArticle(tx);
        await expect(
          updateArticleStatus(tx, ADMIN, articleId, { status: 'NONSENSE' }),
        ).rejects.toBeTruthy();
      });
    });

    it('filters Articles by source, status, and search term', async () => {
      await inRollbackTx(async (tx) => {
        const source = await createSource(tx, ADMIN, {
          ...baseSource,
          slug: 'filter-src',
        });
        const articles = new ArticleRepository(tx);
        await articles.create({
          sourceId: source.id,
          url: 'https://example.com/alpha',
          originalTitle: 'Alpha release notes',
          urlHash: 'h-alpha',
        });
        const beta = await articles.create({
          sourceId: source.id,
          url: 'https://example.com/beta',
          originalTitle: 'Beta announcement',
          urlHash: 'h-beta',
        });
        await tx.query('UPDATE articles SET status = $2 WHERE id = $1', [
          beta.id,
          'HIDDEN',
        ]);

        expect(await articles.count({ sourceId: source.id })).toBe(2);
        expect(
          await articles.count({ sourceId: source.id, status: 'HIDDEN' }),
        ).toBe(1);

        const search = await articles.search({
          sourceId: source.id,
          search: 'alpha',
        });
        expect(search).toHaveLength(1);
        expect(search[0]?.original_title).toBe('Alpha release notes');

        // A wildcard in the term is treated literally, not as SQL wildcard.
        expect(await articles.count({ sourceId: source.id, search: '%' })).toBe(
          0,
        );
      });
    });
  });

  describe('topic management', () => {
    async function topLevelParent(tx: Db): Promise<string> {
      const result = await tx.query<{ id: string }>(
        `INSERT INTO topics (name, slug) VALUES ('Parent Test', 'parent-test')
         RETURNING id`,
      );
      return result.rows[0]!.id;
    }

    it('creates a sub-Topic under a top-level parent and audits', async () => {
      await inRollbackTx(async (tx) => {
        const parentId = await topLevelParent(tx);
        const created = await createTopic(tx, ADMIN, {
          name: 'Sub Topic',
          parentId,
        });
        expect(created.parent_id).toBe(parentId);

        const audit = await new AdminAuditLogRepository(tx).listRecent({
          targetType: 'topic',
          targetId: created.id,
        });
        expect(audit[0]?.action).toBe('TOPIC_CREATE');
      });
    });

    it('refuses to nest a sub-Topic under a non-top-level parent', async () => {
      await inRollbackTx(async (tx) => {
        const parentId = await topLevelParent(tx);
        const sub = await createTopic(tx, ADMIN, {
          name: 'First Level',
          parentId,
        });
        await expect(
          createTopic(tx, ADMIN, { name: 'Too Deep', parentId: sub.id }),
        ).rejects.toBeInstanceOf(AdminValidationError);
      });
    });

    it('rejects a VIEWER creating a Topic', async () => {
      await inRollbackTx(async (tx) => {
        const parentId = await topLevelParent(tx);
        await expect(
          createTopic(tx, VIEWER, { name: 'Nope', parentId }),
        ).rejects.toBeInstanceOf(UnauthorizedError);
      });
    });
  });

  describe('fetch inspection', () => {
    it('lists recent fetches globally and filters by status', async () => {
      await inRollbackTx(async (tx) => {
        const source = await createSource(tx, ADMIN, {
          ...baseSource,
          slug: 'fetch-src',
        });
        const fetches = new SourceFetchRepository(tx);
        const ok = await fetches.start(source.id);
        await fetches.complete(ok.id, { status: 'SUCCESS', itemsNew: 3 });
        const bad = await fetches.start(source.id);
        await fetches.complete(bad.id, {
          status: 'FAILED',
          errorCode: 'TIMEOUT',
        });

        const all = await fetches.listRecentGlobal({ limit: 100 });
        const forSource = all.filter((f) => f.source_id === source.id);
        expect(forSource.length).toBe(2);
        expect(forSource[0]?.source_slug).toBe('fetch-src');

        const failed = await fetches.listRecentGlobal({
          limit: 100,
          status: 'FAILED',
        });
        const failedForSource = failed.filter((f) => f.source_id === source.id);
        expect(failedForSource).toHaveLength(1);
        expect(failedForSource[0]?.error_code).toBe('TIMEOUT');
      });
    });
  });
});
