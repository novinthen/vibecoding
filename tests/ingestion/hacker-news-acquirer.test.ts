import { describe, expect, it } from 'vitest';

import type { SourceRow } from '@/domain/types';
import { hackerNewsAcquirer, IngestError } from '@/ingestion';
import type {
  AcquisitionContext,
  FeedFetcher,
  FeedResponse,
} from '@/ingestion';

/**
 * Deterministic Hacker News acquirer tests.
 *
 * No test performs a live network call: an injected {@link FeedFetcher} fake maps
 * each Firebase URL (a story-id list or an item) to a stored JSON body. Fixtures
 * cover story-only filtering, comment/deleted/dead/malformed exclusion, external
 * vs discussion URL selection, bounded item counts, and the id/top/best/new
 * modes.
 */

function makeSource(overrides: Partial<SourceRow> = {}): SourceRow {
  return {
    id: 'hn-src',
    name: 'Hacker News',
    slug: 'hacker-news',
    homepage_url: null,
    feed_url: null,
    source_type: 'HACKER_NEWS',
    authority_tier: 'COMMUNITY',
    poll_interval: null,
    enabled: true,
    language: 'en',
    default_topic_id: null,
    source_config: { mode: 'top', maxItems: 50 },
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

/** Build a fetcher backed by a URL→body map. Missing URLs return "null". */
function mapFetcher(
  bodies: Record<string, unknown>,
  calls: string[] = [],
): FeedFetcher {
  return (url) => {
    calls.push(url);
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

function ctxWith(fetchFeed: FeedFetcher): AcquisitionContext {
  return {
    fetchFeed,
    adapter: {
      name: 'unused',
      sourceTypes: [],
      supports: () => false,
      parse: () => ({ title: null, language: null, items: [] }),
    },
    now: () => new Date('2025-08-09T00:00:00.000Z'),
  };
}

const story = {
  id: 111,
  type: 'story',
  by: 'alice',
  time: 1_700_000_000,
  title: 'A great coding tool',
  url: 'https://example.com/tool',
  score: 250,
  descendants: 42,
};

const askStory = {
  id: 222,
  type: 'story',
  by: 'bob',
  time: 1_700_000_500,
  title: 'Ask HN: best vibe coding setup?',
  text: 'I want <b>recommendations</b> for my editor.',
  score: 90,
  descendants: 30,
};

const comment = {
  id: 333,
  type: 'comment',
  by: 'carol',
  time: 1,
  text: 'nice',
};
const deleted = { id: 444, deleted: true };
const dead = {
  id: 555,
  type: 'story',
  dead: true,
  title: 'spam',
  by: 'x',
  time: 1,
};

describe('hackerNewsAcquirer — item selection', () => {
  it('ingests story items only, excluding comments/deleted/dead/missing', async () => {
    const calls: string[] = [];
    const fetcher = mapFetcher(
      {
        'topstories.json': [111, 222, 333, 444, 555, 999],
        'item/111.json': story,
        'item/222.json': askStory,
        'item/333.json': comment,
        'item/444.json': deleted,
        'item/555.json': dead,
        // 999 → falls through to "null" (missing item)
      },
      calls,
    );
    const result = await hackerNewsAcquirer.acquire(
      makeSource(),
      ctxWith(fetcher),
    );
    expect(result.items.map((i) => i.externalId)).toEqual([
      'hn:item:111',
      'hn:item:222',
    ]);
    expect(result.notModified).toBe(false);
    expect(result.etag).toBeNull();
  });

  it('uses the external URL for a link story and the discussion URL for Ask HN', async () => {
    const fetcher = mapFetcher({
      'topstories.json': [111, 222],
      'item/111.json': story,
      'item/222.json': askStory,
    });
    const result = await hackerNewsAcquirer.acquire(
      makeSource(),
      ctxWith(fetcher),
    );
    const link = result.items.find((i) => i.externalId === 'hn:item:111');
    const ask = result.items.find((i) => i.externalId === 'hn:item:222');
    expect(link?.url).toBe('https://example.com/tool');
    expect(ask?.url).toBe('https://news.ycombinator.com/item?id=222');
    // Ask HN text becomes a plain-ish excerpt; link story has none.
    expect(ask?.excerpt).toBe('I want recommendations for my editor.');
    expect(link?.excerpt).toBeNull();
  });

  it('maps source facts (author, published time, language) and no engagement', async () => {
    const fetcher = mapFetcher({
      'topstories.json': [111],
      'item/111.json': story,
    });
    const result = await hackerNewsAcquirer.acquire(
      makeSource(),
      ctxWith(fetcher),
    );
    const item = result.items[0];
    expect(item?.title).toBe('A great coding tool');
    expect(item?.author).toBe('alice');
    expect(item?.publishedAt?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
    expect(item?.language).toBe('en');
    // The canonical item shape carries no score/comment fields.
    expect(Object.keys(item ?? {})).not.toContain('score');
    expect(Object.keys(item ?? {})).not.toContain('descendants');
  });

  it('bounds the number of items fetched by maxItems', async () => {
    const calls: string[] = [];
    const fetcher = mapFetcher(
      {
        'topstories.json': [111, 222, 333],
        'item/111.json': story,
        'item/222.json': askStory,
        'item/333.json': comment,
      },
      calls,
    );
    await hackerNewsAcquirer.acquire(
      makeSource({ source_config: { mode: 'top', maxItems: 2 } }),
      ctxWith(fetcher),
    );
    // 1 list call + at most 2 item calls.
    const itemCalls = calls.filter((c) => c.includes('/item/'));
    expect(itemCalls).toHaveLength(2);
  });

  it('supports the best and new list endpoints', async () => {
    const calls: string[] = [];
    const fetcher = mapFetcher(
      { 'beststories.json': [111], 'item/111.json': story },
      calls,
    );
    await hackerNewsAcquirer.acquire(
      makeSource({ source_config: { mode: 'best', maxItems: 10 } }),
      ctxWith(fetcher),
    );
    expect(calls[0]).toContain('beststories.json');
  });

  it('supports explicit configured item ids without a list call', async () => {
    const calls: string[] = [];
    const fetcher = mapFetcher(
      { 'item/111.json': story, 'item/222.json': askStory },
      calls,
    );
    const result = await hackerNewsAcquirer.acquire(
      makeSource({
        source_config: { mode: 'ids', maxItems: 50, ids: [111, 222] },
      }),
      ctxWith(fetcher),
    );
    expect(calls.some((c) => c.includes('stories.json'))).toBe(false);
    expect(result.items.map((i) => i.externalId)).toEqual([
      'hn:item:111',
      'hn:item:222',
    ]);
  });

  it('isolates a single failed item fetch without failing the run', async () => {
    const calls: string[] = [];
    const fetcher: FeedFetcher = (url) => {
      calls.push(url);
      if (url.includes('topstories.json')) {
        return Promise.resolve({
          status: 200,
          notModified: false,
          body: JSON.stringify([111, 222]),
          etag: null,
          lastModified: null,
          contentType: 'application/json',
          finalUrl: url,
        });
      }
      if (url.includes('item/111.json')) {
        return Promise.reject(new Error('network blip'));
      }
      return Promise.resolve({
        status: 200,
        notModified: false,
        body: JSON.stringify(askStory),
        etag: null,
        lastModified: null,
        contentType: 'application/json',
        finalUrl: url,
      });
    };
    const result = await hackerNewsAcquirer.acquire(
      makeSource(),
      ctxWith(fetcher),
    );
    // 111 failed and was skipped; 222 still ingested.
    expect(result.items.map((i) => i.externalId)).toEqual(['hn:item:222']);
  });

  it('raises MALFORMED_FEED when the story list is not an array', async () => {
    const fetcher = mapFetcher({ 'topstories.json': { error: 'nope' } });
    await expect(
      hackerNewsAcquirer.acquire(makeSource(), ctxWith(fetcher)),
    ).rejects.toMatchObject({ code: 'MALFORMED_FEED' });
  });
});

describe('hackerNewsAcquirer — per-item failure observability', () => {
  /** A fetcher where the list succeeds and each item id maps to a behaviour. */
  function itemBehaviourFetcher(
    ids: number[],
    behaviour: (id: number) => Promise<FeedResponse> | FeedResponse,
  ): FeedFetcher {
    return (url) => {
      if (url.includes('topstories.json')) {
        return Promise.resolve({
          status: 200,
          notModified: false,
          body: JSON.stringify(ids),
          etag: null,
          lastModified: null,
          contentType: 'application/json',
          finalUrl: url,
        });
      }
      const match = url.match(/item\/(\d+)\.json/);
      const id = match ? Number(match[1]) : 0;
      return Promise.resolve(behaviour(id));
    };
  }

  const okStory = (id: number): FeedResponse => ({
    status: 200,
    notModified: false,
    body: JSON.stringify({
      id,
      type: 'story',
      by: 'a',
      time: 1_700_000_000,
      title: `story ${id}`,
      url: `https://example.com/${id}`,
    }),
    etag: null,
    lastModified: null,
    contentType: 'application/json',
    finalUrl: `item/${id}`,
  });

  it('records a 5xx item as an acquisition failure while keeping valid items', async () => {
    const fetcher = itemBehaviourFetcher([111, 222], (id) => {
      if (id === 111) {
        return Promise.reject(
          new IngestError('HTTP_SERVER_ERROR', 'Upstream server error', {
            retryable: true,
            httpStatus: 503,
          }),
        );
      }
      return okStory(id);
    });
    const result = await hackerNewsAcquirer.acquire(
      makeSource(),
      ctxWith(fetcher),
    );
    expect(result.items.map((i) => i.externalId)).toEqual(['hn:item:222']);
    expect(result.attempted).toBe(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures?.[0]).toMatchObject({
      ref: 'hn:item:111',
      code: 'HTTP_SERVER_ERROR',
      retryable: true,
    });
  });

  it('records a timed-out item as a retryable acquisition failure', async () => {
    const fetcher = itemBehaviourFetcher([111, 222], (id) => {
      if (id === 111) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      }
      return okStory(id);
    });
    const result = await hackerNewsAcquirer.acquire(
      makeSource(),
      ctxWith(fetcher),
    );
    expect(result.items).toHaveLength(1);
    expect(result.failures?.[0]).toMatchObject({
      code: 'TIMEOUT',
      retryable: true,
    });
  });

  it('reports every requested item as a failure when all item fetches fail', async () => {
    const fetcher = itemBehaviourFetcher([111, 222], () =>
      Promise.reject(
        new IngestError('HTTP_SERVER_ERROR', 'boom', {
          retryable: true,
          httpStatus: 500,
        }),
      ),
    );
    const result = await hackerNewsAcquirer.acquire(
      makeSource(),
      ctxWith(fetcher),
    );
    expect(result.items).toHaveLength(0);
    expect(result.failures).toHaveLength(2);
    expect(result.attempted).toBe(2);
  });

  it('treats dead/comment items as intentional skips, not failures', async () => {
    const fetcher = mapFetcher({
      'topstories.json': [333, 555],
      'item/333.json': comment,
      'item/555.json': dead,
    });
    const result = await hackerNewsAcquirer.acquire(
      makeSource(),
      ctxWith(fetcher),
    );
    expect(result.items).toHaveLength(0);
    expect(result.failures).toHaveLength(0);
    expect(result.attempted).toBe(2);
  });
});
