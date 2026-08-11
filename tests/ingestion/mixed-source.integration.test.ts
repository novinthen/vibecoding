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

      // No automation ever auto-publishes: Articles remain in the discovered state.
      expect(
        [...rssRows, ...ghRows, ...hnRows].every(
          (r) => r.status === 'DISCOVERED',
        ),
      ).toBe(true);
      const published = await tx.query(
        'SELECT COUNT(*)::int AS n FROM publication_stories',
      );
      expect(published.rows[0]?.n).toBe(0);

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
});
