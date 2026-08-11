import { describe, expect, it } from 'vitest';

import type {
  CompleteFetchInput,
  CreateArticleInput,
  UpdateFetchStateInput,
} from '@/domain';
import type { ArticleRow, SourceFetchRow, SourceRow } from '@/domain/types';
import { ingestSource, type FeedFetcher, type IngestDeps } from '@/ingestion';
import type { FeedResponse } from '@/ingestion';

/**
 * Dispatch integration (in-memory): GitHub and Hacker News Sources flow through
 * the SAME {@link ingestSource} orchestrator — canonicalization, exact dedup,
 * Article persistence, and SourceFetch audit — as RSS/Atom, proving they are new
 * inputs rather than new pipelines. The fetcher is always faked; no network.
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
  readonly completed: Array<{ id: string; input: CompleteFetchInput }> = [];
  private seq = 0;
  start(sourceId: string): Promise<SourceFetchRow> {
    this.seq += 1;
    return Promise.resolve({
      id: `fetch-${this.seq}`,
      source_id: sourceId,
      status: 'STARTED',
      metadata: {},
    } as SourceFetchRow);
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
  updateFetchState(_id: string, _input: UpdateFetchStateInput): Promise<void> {
    return Promise.resolve();
  }
}

function jsonFetcher(bodies: Record<string, unknown>): FeedFetcher {
  return (url) => {
    const key = Object.keys(bodies).find((k) => url.includes(k));
    const body = key !== undefined ? JSON.stringify(bodies[key]) : 'null';
    const response: FeedResponse = {
      status: 200,
      notModified: false,
      body,
      etag: null,
      lastModified: null,
      contentType: 'application/json',
      finalUrl: url,
    };
    return Promise.resolve(response);
  };
}

function depsWith(
  fetchFeed: FeedFetcher,
): IngestDeps & { articles: FakeArticles; sourceFetches: FakeSourceFetches } {
  return {
    articles: new FakeArticles(),
    sourceFetches: new FakeSourceFetches(),
    sources: new FakeSources(),
    fetchFeed,
    now: () => new Date('2025-08-09T00:00:00.000Z'),
    githubToken: null,
  };
}

function githubSource(): SourceRow {
  return {
    id: 'gh',
    name: 'GH',
    slug: 'gh',
    homepage_url: null,
    feed_url: null,
    source_type: 'GITHUB',
    authority_tier: 'TRUSTED',
    poll_interval: null,
    enabled: true,
    language: 'en',
    default_topic_id: null,
    source_config: { owner: 'o', repo: 'r' },
    last_fetch_at: null,
    last_success_at: null,
    failure_count: 0,
    health_status: 'UNKNOWN',
    etag: null,
    last_modified: null,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
  };
}

function hnSource(): SourceRow {
  return {
    ...githubSource(),
    id: 'hn',
    slug: 'hn',
    source_type: 'HACKER_NEWS',
    source_config: { mode: 'top', maxItems: 50 },
  };
}

describe('ingestSource — GitHub dispatch', () => {
  const release = (title: string) => ({
    id: 100,
    html_url: 'https://github.com/o/r/releases/tag/v1',
    tag_name: 'v1',
    name: title,
    body: 'notes',
    draft: false,
    prerelease: false,
    created_at: '2024-01-01T00:00:00Z',
    published_at: '2024-01-01T00:00:00Z',
    author: { login: 'a' },
  });

  it('persists releases as Articles and records SUCCESS', async () => {
    const deps = depsWith(jsonFetcher({ '/releases': [release('v1')] }));
    const result = await ingestSource(githubSource(), deps);
    expect(result.status).toBe('SUCCESS');
    expect(result.itemsNew).toBe(1);
    expect(deps.articles.rows[0]?.external_id).toBe('github:release:100');
  });

  it('dedups an edited release (same stable id) — no duplicate Article', async () => {
    const deps = depsWith(jsonFetcher({ '/releases': [release('v1')] }));
    await ingestSource(githubSource(), deps);
    // Re-run with an edited title but the same release id.
    deps.fetchFeed = jsonFetcher({ '/releases': [release('v1 (edited)')] });
    const second = await ingestSource(githubSource(), deps);
    expect(second.itemsNew).toBe(0);
    expect(second.itemsExisting).toBe(1);
    expect(deps.articles.rows).toHaveLength(1);
  });
});

describe('ingestSource — Hacker News dispatch', () => {
  const story = {
    id: 7,
    type: 'story',
    by: 'a',
    time: 1_700_000_000,
    title: 'HN story',
    url: 'https://example.com/x',
  };

  it('persists stories as Articles and dedups on re-run', async () => {
    const deps = depsWith(
      jsonFetcher({ 'topstories.json': [7], 'item/7.json': story }),
    );
    const first = await ingestSource(hnSource(), deps);
    expect(first.status).toBe('SUCCESS');
    expect(first.itemsNew).toBe(1);
    expect(deps.articles.rows[0]?.external_id).toBe('hn:item:7');

    const second = await ingestSource(hnSource(), deps);
    expect(second.itemsNew).toBe(0);
    expect(second.itemsExisting).toBe(1);
    expect(deps.sourceFetches.lastCompleted.status).toBe('SUCCESS');
  });
});
