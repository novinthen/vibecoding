import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closePool, getPool, type Db } from '@/db/client';
import { migrate } from '@/db/migrate';
import {
  ArticleRepository,
  SourceFetchRepository,
  SourceRepository,
} from '@/domain';
import type { SourceRow } from '@/domain/types';
import {
  ingestSource,
  IngestError,
  type FeedFetcher,
  type IngestDeps,
} from '@/ingestion';
import { runIngestionJob } from '@/jobs/ingestion-job';

import { loadFixture } from './fixtures';

/**
 * Mixed-source PostgreSQL integration test (Stage 9B).
 *
 * Proves that one RSS Source, one GitHub Releases Source, and one Hacker News
 * Source all flow through the SAME {@link ingestSource} engine against real
 * Postgres: Articles are persisted with canonical URLs and stable external ids,
 * a SourceFetch audit row is recorded per Source, a repeated run creates no
 * duplicates, and nothing is auto-published.
 *
 * Skipped unless DATABASE_URL is set (mirrors the other integration suites), so
 * unit CI stays green without a database. Each test runs inside a rolled-back
 * transaction, so no state leaks. The fetcher is always faked from fixtures —
 * no network, no live GitHub or Hacker News call.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

const githubReleases = loadFixture('github-releases.json');
const rssFeed = loadFixture('rss-basic.xml');

const hnStory = JSON.stringify({
  id: 1,
  type: 'story',
  by: 'alice',
  time: 1_700_000_000,
  title: 'Mixed-source HN story',
  url: 'https://example.com/hn-target',
});

/** One fetcher dispatching by URL to the right fixture body/content-type. */
const mixedFetcher: FeedFetcher = (url) => {
  let body = rssFeed;
  let contentType: string | null = 'application/xml';
  if (url.includes('api.github.com')) {
    body = githubReleases;
    contentType = 'application/json';
  } else if (url.includes('topstories.json')) {
    body = JSON.stringify([1]);
    contentType = 'application/json';
  } else if (url.includes('/item/1.json')) {
    body = hnStory;
    contentType = 'application/json';
  }
  return Promise.resolve({
    status: 200,
    notModified: false,
    body,
    etag: null,
    lastModified: null,
    contentType,
    finalUrl: url,
  });
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

function depsFor(tx: Db): IngestDeps {
  return {
    articles: new ArticleRepository(tx),
    sourceFetches: new SourceFetchRepository(tx),
    sources: new SourceRepository(tx),
    fetchFeed: mixedFetcher,
    githubToken: null,
  };
}

let uniq = 0;
async function makeSource(
  tx: Db,
  input: {
    sourceType: SourceRow['source_type'];
    feedUrl?: string | null;
    sourceConfig?: Record<string, unknown>;
  },
): Promise<SourceRow> {
  uniq += 1;
  return new SourceRepository(tx).create({
    name: `Mixed ${input.sourceType} ${uniq}`,
    slug: `mixed-${input.sourceType.toLowerCase()}-${Date.now()}-${uniq}`,
    sourceType: input.sourceType,
    authorityTier: 'TRUSTED',
    feedUrl: input.feedUrl ?? null,
    language: 'en',
    sourceConfig: input.sourceConfig,
  });
}

describe.skipIf(!hasDb)('mixed-source ingestion (integration)', () => {
  beforeAll(async () => {
    await migrate();
  });

  afterAll(async () => {
    await closePool();
  });

  it('ingests RSS, GitHub, and HN Sources through one engine with no duplicates or auto-publish', async () => {
    await inRollbackTx(async (tx) => {
      const rss = await makeSource(tx, {
        sourceType: 'RSS',
        feedUrl: 'https://example.com/feed',
      });
      const github = await makeSource(tx, {
        sourceType: 'GITHUB',
        sourceConfig: {
          owner: 'vercel',
          repo: 'next.js',
          prereleases: 'exclude',
        },
      });
      const hn = await makeSource(tx, {
        sourceType: 'HACKER_NEWS',
        sourceConfig: { mode: 'top', maxItems: 10 },
      });

      const articles = new ArticleRepository(tx);
      const fetches = new SourceFetchRepository(tx);

      // First run: every Source produces Articles through the same engine.
      for (const source of [rss, github, hn]) {
        const result = await ingestSource(source, depsFor(tx));
        expect(result.status).toBe('SUCCESS');
        expect(result.itemsNew).toBeGreaterThan(0);
      }

      const rssRows = await articles.listBySource(rss.id);
      const ghRows = await articles.listBySource(github.id);
      const hnRows = await articles.listBySource(hn.id);
      expect(rssRows.length).toBe(2);
      // github-releases.json → 2 ingestable releases (drafts/prereleases/malformed excluded).
      expect(ghRows.length).toBe(2);
      expect(hnRows.length).toBe(1);

      // Stable external ids and canonical URLs are populated for dedup.
      expect(
        ghRows.every((r) => r.external_id?.startsWith('github:release:')),
      ).toBe(true);
      expect(hnRows[0]?.external_id).toBe('hn:item:1');
      expect(
        [...rssRows, ...ghRows, ...hnRows].every(
          (r) => r.canonical_url && r.url_hash,
        ),
      ).toBe(true);

      // No automation ever auto-publishes: Articles remain in the discovered
      // state (ingestion never sets PUBLISHED, and never creates a Story or
      // PublicationStory — those are separate, explicit workflows).
      expect(
        [...rssRows, ...ghRows, ...hnRows].every(
          (r) => r.status === 'DISCOVERED',
        ),
      ).toBe(true);

      // A SourceFetch audit row exists per Source.
      for (const source of [rss, github, hn]) {
        const recent = await fetches.listRecent(source.id);
        expect(recent).toHaveLength(1);
        expect(recent[0]?.status).toBe('SUCCESS');
      }

      // Second run: idempotent — no duplicate Articles for any Source.
      for (const source of [rss, github, hn]) {
        const result = await ingestSource(source, depsFor(tx));
        expect(result.itemsNew).toBe(0);
      }
      expect((await articles.listBySource(rss.id)).length).toBe(2);
      expect((await articles.listBySource(github.id)).length).toBe(2);
      expect((await articles.listBySource(hn.id)).length).toBe(1);
    });
  });

  it('refreshes an edited GitHub release in place without duplicating (createOrRefresh)', async () => {
    await inRollbackTx(async (tx) => {
      const github = await makeSource(tx, {
        sourceType: 'GITHUB',
        sourceConfig: { owner: 'o', repo: 'r' },
      });
      const articles = new ArticleRepository(tx);
      const fetches = new SourceFetchRepository(tx);

      const releaseBody = (name: string, body: string) =>
        JSON.stringify([
          {
            id: 500,
            html_url: 'https://github.com/o/r/releases/tag/v1',
            tag_name: 'v1',
            name,
            body,
            draft: false,
            prerelease: false,
            created_at: '2024-01-01T00:00:00Z',
            published_at: '2024-01-01T00:00:00Z',
            author: { login: 'a' },
          },
        ]);
      const ghFetcher = (name: string, body: string): FeedFetcher => {
        return (url) =>
          Promise.resolve({
            status: 200,
            notModified: false,
            body: releaseBody(name, body),
            etag: null,
            lastModified: null,
            contentType: 'application/json',
            finalUrl: url,
          });
      };
      const depsGh = (fetchFeed: FeedFetcher): IngestDeps => ({
        articles,
        sourceFetches: fetches,
        sources: new SourceRepository(tx),
        fetchFeed,
        githubToken: null,
      });

      const first = await ingestSource(
        github,
        depsGh(ghFetcher('Release v1', 'Original notes')),
      );
      expect(first.itemsNew).toBe(1);

      const before = (await articles.listBySource(github.id))[0];
      expect(before?.original_title).toBe('Release v1');

      // Edit the release (same stable id, changed name/body).
      const second = await ingestSource(
        github,
        depsGh(ghFetcher('Release v1 (patched)', 'Updated notes')),
      );
      expect(second.itemsNew).toBe(0);
      expect(second.itemsUpdated).toBe(1);
      expect(second.itemsExisting).toBe(0);

      const after = await articles.listBySource(github.id);
      expect(after).toHaveLength(1); // No duplicate.
      expect(after[0]?.id).toBe(before?.id); // Same row, refreshed in place.
      expect(after[0]?.original_title).toBe('Release v1 (patched)');
      // Editorial/derived state untouched: status remains the discovered default.
      expect(after[0]?.status).toBe('DISCOVERED');

      // SourceFetch reports the update accurately.
      const recent = await fetches.listRecent(github.id);
      expect(recent[0]?.items_updated).toBe(1);

      // A truly unchanged re-run is a no-op.
      const third = await ingestSource(
        github,
        depsGh(ghFetcher('Release v1 (patched)', 'Updated notes')),
      );
      expect(third.itemsUpdated).toBe(0);
      expect(third.itemsExisting).toBe(1);
    });
  });

  it('records PARTIAL and keeps health observable when an HN item fetch fails', async () => {
    await inRollbackTx(async (tx) => {
      const hn = await makeSource(tx, {
        sourceType: 'HACKER_NEWS',
        sourceConfig: { mode: 'top', maxItems: 10 },
      });
      const articles = new ArticleRepository(tx);
      const fetches = new SourceFetchRepository(tx);

      const okStory = (id: number) => ({
        id,
        type: 'story',
        by: 'a',
        time: 1_700_000_000,
        title: `story ${id}`,
        url: `https://example.com/${id}`,
      });
      // List [1,2]; item 1 fails with a 5xx, item 2 succeeds.
      const partialFetcher: FeedFetcher = (url) => {
        if (url.includes('topstories.json')) {
          return Promise.resolve({
            status: 200,
            notModified: false,
            body: JSON.stringify([1, 2]),
            etag: null,
            lastModified: null,
            contentType: 'application/json',
            finalUrl: url,
          });
        }
        if (url.includes('/item/1.json')) {
          return Promise.reject(
            new IngestError('HTTP_SERVER_ERROR', 'boom', {
              retryable: true,
              httpStatus: 503,
            }),
          );
        }
        return Promise.resolve({
          status: 200,
          notModified: false,
          body: JSON.stringify(okStory(2)),
          etag: null,
          lastModified: null,
          contentType: 'application/json',
          finalUrl: url,
        });
      };

      const result = await ingestSource(hn, {
        articles,
        sourceFetches: fetches,
        sources: new SourceRepository(tx),
        fetchFeed: partialFetcher,
      });
      expect(result.status).toBe('PARTIAL');
      expect(result.itemsNew).toBe(1);
      expect(result.itemsFailed).toBe(1);

      // One Article persisted (the successful item).
      expect((await articles.listBySource(hn.id)).length).toBe(1);

      // SourceFetch records PARTIAL with bounded failure metadata.
      const recent = await fetches.listRecent(hn.id);
      expect(recent[0]?.status).toBe('PARTIAL');
      const meta = recent[0]?.metadata as {
        itemsFailed?: number;
        retryableFailures?: number;
        failures?: unknown[];
      };
      expect(meta.itemsFailed).toBe(1);
      expect(meta.retryableFailures).toBe(1);
      expect(Array.isArray(meta.failures)).toBe(true);

      // Health: a PARTIAL is still a successful contact (the Source is reachable).
      const refreshed = await new SourceRepository(tx).findById(hn.id);
      expect(refreshed?.last_success_at).not.toBeNull();
    });
  });

  it('marks the Source FAILED (not SUCCESS) when every HN item fails', async () => {
    await inRollbackTx(async (tx) => {
      const hn = await makeSource(tx, {
        sourceType: 'HACKER_NEWS',
        sourceConfig: { mode: 'top', maxItems: 10 },
      });
      const fetches = new SourceFetchRepository(tx);
      const allFail: FeedFetcher = (url) => {
        if (url.includes('topstories.json')) {
          return Promise.resolve({
            status: 200,
            notModified: false,
            body: JSON.stringify([1, 2]),
            etag: null,
            lastModified: null,
            contentType: 'application/json',
            finalUrl: url,
          });
        }
        return Promise.reject(
          new IngestError('HTTP_SERVER_ERROR', 'boom', {
            retryable: true,
            httpStatus: 503,
          }),
        );
      };
      const result = await ingestSource(hn, {
        articles: new ArticleRepository(tx),
        sourceFetches: fetches,
        sources: new SourceRepository(tx),
        fetchFeed: allFail,
      });
      expect(result.status).toBe('FAILED');
      expect(result.itemsFailed).toBe(2);

      const recent = await fetches.listRecent(hn.id);
      expect(recent[0]?.status).toBe('FAILED');

      // Health degraded (a total item-acquisition failure is not healthy).
      const refreshed = await new SourceRepository(tx).findById(hn.id);
      expect(refreshed?.failure_count).toBe(1);
      expect(refreshed?.last_success_at).toBeNull();
    });
  });

  it('drives a mixed RSS+GitHub+HN batch through the Stage 9A ingestion job', async () => {
    // The Stage 9A job selects Sources via the pool, so the rows must be
    // committed (not inside a rollback tx). Create them, run the job with an
    // injected deterministic fetcher, then clean up every row we created.
    const pool = getPool();
    const repo = new SourceRepository(pool);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let rssId = '';
    let ghId = '';
    let hnId = '';
    try {
      const rss = await repo.create({
        name: 'Job RSS',
        slug: `job-rss-${suffix}`,
        sourceType: 'RSS',
        authorityTier: 'TRUSTED',
        feedUrl: 'https://example.com/feed',
        language: 'en',
      });
      const github = await repo.create({
        name: 'Job GitHub',
        slug: `job-gh-${suffix}`,
        sourceType: 'GITHUB',
        authorityTier: 'TRUSTED',
        language: 'en',
        sourceConfig: { owner: 'vercel', repo: 'next.js' },
      });
      const hn = await repo.create({
        name: 'Job HN',
        slug: `job-hn-${suffix}`,
        sourceType: 'HACKER_NEWS',
        authorityTier: 'COMMUNITY',
        language: 'en',
        sourceConfig: { mode: 'top', maxItems: 10 },
      });
      rssId = rss.id;
      ghId = github.id;
      hnId = hn.id;

      // Inject the deterministic fetcher so the job never touches the network;
      // the job builds its own pool-bound repositories for persistence.
      const outcome = await runIngestionJob(pool, {
        sourceIds: [rss.id, github.id, hn.id],
        ingestOverrides: { fetchFeed: mixedFetcher, githubToken: null },
      });

      expect(outcome.result.status).toBe('SUCCEEDED');
      expect(outcome.result.succeeded).toBe(3);

      const articles = new ArticleRepository(pool);
      const rssRows = await articles.listBySource(rss.id);
      const ghRows = await articles.listBySource(github.id);
      const hnRows = await articles.listBySource(hn.id);
      expect(rssRows.length).toBe(2);
      expect(ghRows.length).toBe(2);
      expect(hnRows.length).toBe(1);

      // No auto-publishing anywhere in the automated path: every Article stays
      // in the discovered state.
      expect(
        [...rssRows, ...ghRows, ...hnRows].every(
          (r) => r.status === 'DISCOVERED',
        ),
      ).toBe(true);
    } finally {
      const ids = [rssId, ghId, hnId].filter(Boolean);
      if (ids.length > 0) {
        await pool.query('DELETE FROM articles WHERE source_id = ANY($1)', [
          ids,
        ]);
        await pool.query(
          'DELETE FROM source_fetches WHERE source_id = ANY($1)',
          [ids],
        );
        await pool.query('DELETE FROM sources WHERE id = ANY($1)', [ids]);
      }
    }
  });
});
