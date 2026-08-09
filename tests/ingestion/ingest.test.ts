import { beforeEach, describe, expect, it } from 'vitest';

import type {
  CompleteFetchInput,
  CreateArticleInput,
  UpdateFetchStateInput,
} from '@/domain';
import type { ArticleRow, SourceFetchRow, SourceRow } from '@/domain/types';
import {
  IngestError,
  ingestSource,
  ingestSources,
  type FeedFetcher,
  type IngestDeps,
} from '@/ingestion';
import type { FeedResponse } from '@/ingestion';

import { loadFixture } from './fixtures';

/**
 * In-memory fakes for the orchestrator's small dependency surface. These make
 * the full pipeline deterministic without a database or network, mirroring the
 * exact-dedup semantics the real Postgres unique indexes enforce.
 */

class FakeArticles {
  readonly rows: ArticleRow[] = [];
  private seq = 0;

  createIfAbsent(input: CreateArticleInput): Promise<ArticleRow | null> {
    const clash = this.rows.find(
      (r) =>
        r.source_id === input.sourceId &&
        ((input.externalId != null && r.external_id === input.externalId) ||
          (input.urlHash != null && r.url_hash === input.urlHash)),
    );
    if (clash) return Promise.resolve(null);
    this.seq += 1;
    const row = {
      id: `article-${this.seq}`,
      source_id: input.sourceId,
      external_id: input.externalId ?? null,
      url: input.url,
      canonical_url: input.canonicalUrl ?? null,
      url_hash: input.urlHash ?? null,
      original_title: input.originalTitle,
      content_hash: input.contentHash ?? null,
    } as ArticleRow;
    this.rows.push(row);
    return Promise.resolve(row);
  }
}

class FakeSourceFetches {
  readonly started: SourceFetchRow[] = [];
  readonly completed: Array<{ id: string; input: CompleteFetchInput }> = [];
  private seq = 0;

  start(sourceId: string): Promise<SourceFetchRow> {
    this.seq += 1;
    const row = {
      id: `fetch-${this.seq}`,
      source_id: sourceId,
      status: 'STARTED',
      metadata: {},
    } as SourceFetchRow;
    this.started.push(row);
    return Promise.resolve(row);
  }

  complete(id: string, input: CompleteFetchInput): Promise<void> {
    this.completed.push({ id, input });
    return Promise.resolve();
  }

  get lastCompleted(): CompleteFetchInput {
    const last = this.completed.at(-1);
    if (!last) throw new Error('no completed fetch');
    return last.input;
  }
}

class FakeSources {
  readonly updates: Array<{ id: string; input: UpdateFetchStateInput }> = [];

  updateFetchState(id: string, input: UpdateFetchStateInput): Promise<void> {
    this.updates.push({ id, input });
    return Promise.resolve();
  }

  get lastUpdate(): UpdateFetchStateInput {
    const last = this.updates.at(-1);
    if (!last) throw new Error('no update');
    return last.input;
  }
}

function makeSource(overrides: Partial<SourceRow> = {}): SourceRow {
  return {
    id: 'src-1',
    name: 'Test',
    slug: 'test',
    homepage_url: null,
    feed_url: 'https://example.com/feed',
    source_type: 'RSS',
    authority_tier: 'PRIMARY',
    poll_interval: null,
    enabled: true,
    language: null,
    default_topic_id: null,
    last_fetch_at: null,
    last_success_at: null,
    failure_count: 0,
    health_status: 'UNKNOWN',
    etag: null,
    last_modified: null,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A fetcher that always returns a 200 with the given fixture body. */
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

interface TestDeps extends IngestDeps {
  articles: FakeArticles;
  sourceFetches: FakeSourceFetches;
  sources: FakeSources;
  fetchFeed: FeedFetcher;
}

function makeDeps(fetchFeed: FeedFetcher): TestDeps {
  return {
    articles: new FakeArticles(),
    sourceFetches: new FakeSourceFetches(),
    sources: new FakeSources(),
    fetchFeed,
    now: () => new Date('2025-08-09T00:00:00.000Z'),
  };
}

describe('ingestSource — happy path', () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps(fixtureFetcher('rss-basic.xml', { etag: '"v1"' }));
  });

  it('persists new Articles and records a SUCCESS fetch', async () => {
    const result = await ingestSource(makeSource(), deps);
    expect(result.status).toBe('SUCCESS');
    expect(result.itemsFound).toBe(2);
    expect(result.itemsNew).toBe(2);
    expect(deps.articles.rows).toHaveLength(2);

    // SourceFetch audit opened and closed exactly once.
    expect(deps.sourceFetches.started).toHaveLength(1);
    expect(deps.sourceFetches.lastCompleted.status).toBe('SUCCESS');
    expect(deps.sourceFetches.lastCompleted.itemsNew).toBe(2);
  });

  it('sets health HEALTHY and stores the returned ETag validator', async () => {
    await ingestSource(makeSource(), deps);
    expect(deps.sources.lastUpdate.healthStatus).toBe('HEALTHY');
    expect(deps.sources.lastUpdate.failureCount).toBe(0);
    expect(deps.sources.lastUpdate.etag).toBe('"v1"');
    expect(deps.sources.lastUpdate.lastSuccessAt).toBeInstanceOf(Date);
  });

  it('canonicalizes item URLs and dedupes on re-ingest (idempotent)', async () => {
    await ingestSource(makeSource(), deps);
    const second = await ingestSource(makeSource(), deps);
    expect(second.itemsNew).toBe(0);
    expect(second.itemsExisting).toBe(2);
    // No duplicate rows created on the second run.
    expect(deps.articles.rows).toHaveLength(2);
  });
});

describe('ingestSource — dedup across tracking-only URL differences', () => {
  it('treats items differing only in tracking params as duplicates on re-run', async () => {
    const deps = makeDeps(fixtureFetcher('rss-tracking-redirect.xml'));
    await ingestSource(makeSource(), deps);
    expect(deps.articles.rows).toHaveLength(2);
    // Canonical URLs should have tracking params stripped.
    expect(deps.articles.rows[0]?.canonical_url).not.toContain('utm_');
    expect(deps.articles.rows[0]?.canonical_url).not.toContain('fbclid');

    const again = await ingestSource(makeSource(), deps);
    expect(again.itemsNew).toBe(0);
    expect(again.itemsExisting).toBe(2);
  });
});

describe('ingestSource — not modified', () => {
  it('records SKIPPED and writes no Articles on a 304', async () => {
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
    const deps = makeDeps(notModified);
    const result = await ingestSource(
      makeSource({ etag: '"v1"', health_status: 'HEALTHY' }),
      deps,
    );
    expect(result.status).toBe('SKIPPED');
    expect(result.notModified).toBe(true);
    expect(deps.articles.rows).toHaveLength(0);
    expect(deps.sources.lastUpdate.healthStatus).toBe('HEALTHY');
    expect(deps.sourceFetches.lastCompleted.status).toBe('SKIPPED');
  });
});

describe('ingestSource — partial (unusable item URLs)', () => {
  it('drops a single bad-URL item but keeps the feed', async () => {
    const deps = makeDeps(fixtureFetcher('rss-mixed-urls.xml'));
    const result = await ingestSource(makeSource(), deps);
    expect(result.itemsFound).toBe(2);
    expect(result.itemsNew).toBe(1);
    expect(result.itemsSkipped).toBe(1);
    expect(result.status).toBe('SUCCESS');
    expect(deps.articles.rows).toHaveLength(1);
  });
});

describe('ingestSource — failures are observable', () => {
  it('records FAILED + MALFORMED_FEED and degrades health', async () => {
    const deps = makeDeps(fixtureFetcher('malformed.xml'));
    const result = await ingestSource(makeSource(), deps);
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('MALFORMED_FEED');
    expect(deps.sourceFetches.lastCompleted.status).toBe('FAILED');
    expect(deps.sourceFetches.lastCompleted.errorCode).toBe('MALFORMED_FEED');
    expect(deps.sources.lastUpdate.healthStatus).toBe('DEGRADED');
    expect(deps.sources.lastUpdate.failureCount).toBe(1);
    // A failure must not advance the success/validator state.
    expect(deps.sources.lastUpdate.lastSuccessAt).toBeUndefined();
  });

  it('records a fetch-layer HTTP error as FAILED', async () => {
    const failing: FeedFetcher = () =>
      Promise.reject(
        new IngestError('HTTP_SERVER_ERROR', 'boom', {
          retryable: true,
          httpStatus: 503,
        }),
      );
    const deps = makeDeps(failing);
    const result = await ingestSource(makeSource(), deps);
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('HTTP_SERVER_ERROR');
    expect(result.httpStatus).toBe(503);
  });

  it('fails cleanly when no feed_url is configured', async () => {
    const deps = makeDeps(fixtureFetcher('rss-basic.xml'));
    const result = await ingestSource(makeSource({ feed_url: null }), deps);
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('INVALID_URL');
  });
});

describe('ingestSource — health transitions across runs', () => {
  it('escalates HEALTHY → DEGRADED → FAILING then recovers', async () => {
    const deps = makeDeps(fixtureFetcher('malformed.xml'));
    let source = makeSource({ health_status: 'HEALTHY', failure_count: 0 });

    for (const expected of ['DEGRADED', 'DEGRADED', 'FAILING'] as const) {
      await ingestSource(source, deps);
      const update = deps.sources.lastUpdate;
      expect(update.healthStatus).toBe(expected);
      source = makeSource({
        health_status: update.healthStatus,
        failure_count: update.failureCount,
      });
    }

    // Now a successful fetch recovers the Source.
    deps.fetchFeed = fixtureFetcher('rss-basic.xml');
    await ingestSource(source, deps);
    expect(deps.sources.lastUpdate.healthStatus).toBe('HEALTHY');
    expect(deps.sources.lastUpdate.failureCount).toBe(0);
  });
});

describe('ingestSources — isolation', () => {
  it('processes every Source even when one fails', async () => {
    // First source malformed, second source good — a per-source fetcher.
    const deps = makeDeps(fixtureFetcher('rss-basic.xml'));
    deps.fetchFeed = (url) =>
      url.includes('bad')
        ? fixtureFetcher('malformed.xml')(url, {})
        : fixtureFetcher('rss-basic.xml')(url, {});

    const sources = [
      makeSource({
        id: 'bad',
        slug: 'bad',
        feed_url: 'https://example.com/bad',
      }),
      makeSource({
        id: 'good',
        slug: 'good',
        feed_url: 'https://example.com/good',
      }),
    ];
    const results = await ingestSources(sources, deps);
    expect(results).toHaveLength(2);
    expect(results[0]?.status).toBe('FAILED');
    expect(results[1]?.status).toBe('SUCCESS');
    // The good Source's Articles were still written.
    expect(
      deps.articles.rows.filter((r) => r.source_id === 'good'),
    ).toHaveLength(2);
  });
});
