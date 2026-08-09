import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closePool, getPool, type Db } from '@/db/client';
import { migrate } from '@/db/migrate';
import {
  ArticleRepository,
  SourceFetchRepository,
  SourceRepository,
} from '@/domain';
import type { SourceRow } from '@/domain/types';
import { ingestSource, type FeedFetcher, type IngestDeps } from '@/ingestion';
import type { FeedResponse } from '@/ingestion';

import { loadFixture } from './fixtures';

/**
 * Real-database ingestion integration tests.
 *
 * Skipped unless DATABASE_URL is set (mirrors the schema integration suite), so
 * unit CI stays green without a database. Each test runs inside a transaction
 * that is always rolled back, so no state leaks between tests. The fetcher is
 * always faked from a fixture — these tests exercise persistence, exact dedup,
 * SourceFetch recording, and Source-health transitions against real Postgres
 * without hitting the network.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

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

function fixtureFetcher(
  name: string,
  validators: Partial<FeedResponse> = {},
): FeedFetcher {
  return () =>
    Promise.resolve({
      status: 200,
      notModified: false,
      body: loadFixture(name),
      etag: null,
      lastModified: null,
      contentType: 'application/xml',
      finalUrl: 'https://example.com/feed',
      ...validators,
    });
}

function depsFor(tx: Db, fetchFeed: FeedFetcher): IngestDeps {
  return {
    articles: new ArticleRepository(tx),
    sourceFetches: new SourceFetchRepository(tx),
    sources: new SourceRepository(tx),
    fetchFeed,
  };
}

async function makeSource(
  tx: Db,
  overrides: Partial<SourceRow> = {},
): Promise<SourceRow> {
  const repo = new SourceRepository(tx);
  const source = await repo.create({
    name: 'Integration Source',
    slug: `integration-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sourceType: 'RSS',
    authorityTier: 'PRIMARY',
    feedUrl: 'https://example.com/feed',
  });
  if (Object.keys(overrides).length === 0) return source;
  // Apply overrides directly (e.g. seeded health state).
  await tx.query(
    `UPDATE sources SET health_status = COALESCE($2, health_status),
                        failure_count = COALESCE($3, failure_count),
                        etag = $4
     WHERE id = $1`,
    [
      source.id,
      overrides.health_status ?? null,
      overrides.failure_count ?? null,
      overrides.etag ?? null,
    ],
  );
  return (await repo.findById(source.id)) as SourceRow;
}

describe.skipIf(!hasDb)('ingestion (integration)', () => {
  beforeAll(async () => {
    await migrate();
  });

  afterAll(async () => {
    await closePool();
  });

  it('persists Articles, records a SUCCESS SourceFetch, and sets health HEALTHY', async () => {
    await inRollbackTx(async (tx) => {
      const source = await makeSource(tx);
      const deps = depsFor(
        tx,
        fixtureFetcher('rss-basic.xml', { etag: '"v1"' }),
      );

      const result = await ingestSource(source, deps);
      expect(result.status).toBe('SUCCESS');
      expect(result.itemsNew).toBe(2);

      const articles = new ArticleRepository(tx);
      const rows = await articles.listBySource(source.id);
      expect(rows).toHaveLength(2);
      // canonical_url and url_hash are populated for dedup.
      expect(rows.every((r) => r.canonical_url && r.url_hash)).toBe(true);

      const fetches = new SourceFetchRepository(tx);
      const recent = await fetches.listRecent(source.id);
      expect(recent).toHaveLength(1);
      expect(recent[0]?.status).toBe('SUCCESS');
      expect(recent[0]?.items_new).toBe(2);

      const refreshed = await new SourceRepository(tx).findById(source.id);
      expect(refreshed?.health_status).toBe('HEALTHY');
      expect(refreshed?.failure_count).toBe(0);
      expect(refreshed?.etag).toBe('"v1"');
      expect(refreshed?.last_success_at).not.toBeNull();
    });
  });

  it('is idempotent: re-ingesting the same feed creates no duplicate Articles', async () => {
    await inRollbackTx(async (tx) => {
      const source = await makeSource(tx);
      const deps = depsFor(tx, fixtureFetcher('rss-basic.xml'));

      await ingestSource(source, deps);
      const refreshed = (await new SourceRepository(tx).findById(
        source.id,
      )) as SourceRow;
      const second = await ingestSource(refreshed, deps);

      expect(second.itemsNew).toBe(0);
      expect(second.itemsExisting).toBe(2);

      const rows = await new ArticleRepository(tx).listBySource(source.id);
      expect(rows).toHaveLength(2);

      // Two SourceFetch rows were recorded (one per run).
      const recent = await new SourceFetchRepository(tx).listRecent(source.id);
      expect(recent).toHaveLength(2);
    });
  });

  it('records a FAILED SourceFetch and degrades health on a malformed feed', async () => {
    await inRollbackTx(async (tx) => {
      const source = await makeSource(tx, { health_status: 'HEALTHY' });
      const deps = depsFor(tx, fixtureFetcher('malformed.xml'));

      const result = await ingestSource(source, deps);
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('MALFORMED_FEED');

      const recent = await new SourceFetchRepository(tx).listRecent(source.id);
      expect(recent[0]?.status).toBe('FAILED');
      expect(recent[0]?.error_code).toBe('MALFORMED_FEED');

      const refreshed = await new SourceRepository(tx).findById(source.id);
      expect(refreshed?.health_status).toBe('DEGRADED');
      expect(refreshed?.failure_count).toBe(1);
      // A failure must not have advanced last_success_at.
      expect(refreshed?.last_success_at).toBeNull();
    });
  });

  it('transitions health across repeated failures then recovers', async () => {
    await inRollbackTx(async (tx) => {
      let source = await makeSource(tx, { health_status: 'HEALTHY' });
      const sources = new SourceRepository(tx);

      for (const expected of ['DEGRADED', 'DEGRADED', 'FAILING'] as const) {
        await ingestSource(
          source,
          depsFor(tx, fixtureFetcher('malformed.xml')),
        );
        source = (await sources.findById(source.id)) as SourceRow;
        expect(source.health_status).toBe(expected);
      }

      await ingestSource(source, depsFor(tx, fixtureFetcher('rss-basic.xml')));
      source = (await sources.findById(source.id)) as SourceRow;
      expect(source.health_status).toBe('HEALTHY');
      expect(source.failure_count).toBe(0);
    });
  });

  it('honours a 304 Not Modified as SKIPPED without writing Articles', async () => {
    await inRollbackTx(async (tx) => {
      const source = await makeSource(tx, {
        health_status: 'HEALTHY',
        etag: '"v1"',
      });
      const notModified: FeedFetcher = () =>
        Promise.resolve({
          status: 304,
          notModified: true,
          body: null,
          etag: '"v1"',
          lastModified: null,
          contentType: null,
          finalUrl: 'https://example.com/feed',
        });

      const result = await ingestSource(source, depsFor(tx, notModified));
      expect(result.status).toBe('SKIPPED');

      const rows = await new ArticleRepository(tx).listBySource(source.id);
      expect(rows).toHaveLength(0);

      const recent = await new SourceFetchRepository(tx).listRecent(source.id);
      expect(recent[0]?.status).toBe('SKIPPED');

      const refreshed = await new SourceRepository(tx).findById(source.id);
      expect(refreshed?.health_status).toBe('HEALTHY');
    });
  });
});
