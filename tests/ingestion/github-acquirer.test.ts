import { describe, expect, it } from 'vitest';

import type { SourceRow } from '@/domain/types';
import { githubAcquirer, IngestError } from '@/ingestion';
import type {
  AcquisitionContext,
  FeedFetcher,
  FeedResponse,
} from '@/ingestion';

import { loadFixture } from './fixtures';

/**
 * Deterministic GitHub Releases acquirer tests.
 *
 * No test performs a live network call: every request goes through an injected
 * {@link FeedFetcher} fake that returns stored fixtures. Fixtures cover the
 * mapping rules, draft/prerelease policy, stable ids, canonical URLs, bounded
 * excerpts, conditional requests, bounded pagination, and rate-limit
 * classification.
 */

function makeSource(overrides: Partial<SourceRow> = {}): SourceRow {
  return {
    id: 'gh-src',
    name: 'Next.js Releases',
    slug: 'nextjs-releases',
    homepage_url: null,
    feed_url: null,
    source_type: 'GITHUB',
    authority_tier: 'TRUSTED',
    poll_interval: null,
    enabled: true,
    language: 'en',
    default_topic_id: null,
    source_config: { owner: 'vercel', repo: 'next.js' },
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

interface Call {
  url: string;
  headers?: Record<string, string>;
  etag?: string | null;
}

/** A fetcher returning the same body for every call, recording each request. */
function bodyFetcher(
  body: string,
  calls: Call[],
  validators: Partial<FeedResponse> = {},
): FeedFetcher {
  return (url, options) => {
    calls.push({ url, headers: options.headers, etag: options.etag });
    return Promise.resolve({
      status: 200,
      notModified: false,
      body,
      etag: null,
      lastModified: null,
      contentType: 'application/json',
      finalUrl: url,
      ...validators,
    });
  };
}

function ctxWith(fetchFeed: FeedFetcher): AcquisitionContext {
  return {
    fetchFeed,
    // The feed adapter is unused by the GitHub acquirer.
    adapter: {
      name: 'unused',
      sourceTypes: [],
      supports: () => false,
      parse: () => ({ title: null, language: null, items: [] }),
    },
    now: () => new Date('2025-08-09T00:00:00.000Z'),
    githubToken: null,
  };
}

describe('githubAcquirer — release mapping and policy', () => {
  it('excludes drafts, prereleases (default), and malformed releases', async () => {
    const calls: Call[] = [];
    const ctx = ctxWith(
      bodyFetcher(loadFixture('github-releases.json'), calls),
    );
    const result = await githubAcquirer.acquire(makeSource(), ctx);

    // Keeps id 100 (stable) and id 103; drops 101 (prerelease), 102 (draft),
    // 104 (missing html_url).
    expect(result.items.map((i) => i.externalId)).toEqual([
      'github:release:100',
      'github:release:103',
    ]);
    expect(result.notModified).toBe(false);
  });

  it('maps a release to a canonical item (stable id, html_url, author, date)', async () => {
    const calls: Call[] = [];
    const ctx = ctxWith(
      bodyFetcher(loadFixture('github-releases.json'), calls),
    );
    const result = await githubAcquirer.acquire(makeSource(), ctx);

    const first = result.items[0];
    expect(first?.externalId).toBe('github:release:100');
    expect(first?.url).toBe(
      'https://github.com/vercel/next.js/releases/tag/v15.0.0',
    );
    expect(first?.title).toBe('Next.js 15');
    expect(first?.author).toBe('timneutkens');
    expect(first?.publishedAt?.toISOString()).toBe('2024-10-21T13:00:00.000Z');
    expect(first?.language).toBe('en');
    // Excerpt is plain-ish (markdown stripped) and non-empty.
    expect(first?.excerpt).toContain('React 19');
    expect(first?.excerpt).not.toContain('##');
  });

  it('falls back to tag_name when the release name is null', async () => {
    const calls: Call[] = [];
    const ctx = ctxWith(
      bodyFetcher(loadFixture('github-releases.json'), calls),
    );
    const result = await githubAcquirer.acquire(makeSource(), ctx);
    const tagged = result.items.find(
      (i) => i.externalId === 'github:release:103',
    );
    expect(tagged?.title).toBe('v14.2.15');
    expect(tagged?.excerpt).toBeNull();
    expect(tagged?.author).toBeNull();
  });

  it('includes prereleases when policy is "include"', async () => {
    const calls: Call[] = [];
    const ctx = ctxWith(
      bodyFetcher(loadFixture('github-releases.json'), calls),
    );
    const result = await githubAcquirer.acquire(
      makeSource({
        source_config: {
          owner: 'vercel',
          repo: 'next.js',
          prereleases: 'include',
        },
      }),
      ctx,
    );
    expect(result.items.map((i) => i.externalId)).toEqual([
      'github:release:100',
      'github:release:101',
      'github:release:103',
    ]);
  });

  it('keeps only prereleases when policy is "only"', async () => {
    const calls: Call[] = [];
    const ctx = ctxWith(
      bodyFetcher(loadFixture('github-releases.json'), calls),
    );
    const result = await githubAcquirer.acquire(
      makeSource({
        source_config: {
          owner: 'vercel',
          repo: 'next.js',
          prereleases: 'only',
        },
      }),
      ctx,
    );
    expect(result.items.map((i) => i.externalId)).toEqual([
      'github:release:101',
    ]);
  });

  it('bounds the release-note excerpt', async () => {
    const calls: Call[] = [];
    const longBody = 'x '.repeat(2000);
    const body = JSON.stringify([
      {
        id: 200,
        html_url: 'https://github.com/o/r/releases/tag/v1',
        tag_name: 'v1',
        name: 'v1',
        body: longBody,
        draft: false,
        prerelease: false,
        created_at: '2024-01-01T00:00:00Z',
        published_at: '2024-01-01T00:00:00Z',
        author: { login: 'a' },
      },
    ]);
    const ctx = ctxWith(bodyFetcher(body, calls));
    const result = await githubAcquirer.acquire(makeSource(), ctx);
    expect(result.items[0]?.excerpt?.length).toBeLessThanOrEqual(501);
    expect(result.items[0]?.excerpt?.endsWith('…')).toBe(true);
  });
});

describe('githubAcquirer — requests', () => {
  it('targets the official releases endpoint with owner/repo and pagination', async () => {
    const calls: Call[] = [];
    const ctx = ctxWith(bodyFetcher('[]', calls));
    await githubAcquirer.acquire(makeSource(), ctx);
    expect(calls[0]?.url).toBe(
      'https://api.github.com/repos/vercel/next.js/releases?per_page=30&page=1',
    );
  });

  it('sends a Bearer token only when one is configured', async () => {
    const calls: Call[] = [];
    const authed: AcquisitionContext = {
      ...ctxWith(bodyFetcher('[]', calls)),
      githubToken: 'ghp_secret',
    };
    await githubAcquirer.acquire(makeSource(), authed);
    expect(calls[0]?.headers?.['authorization']).toBe('Bearer ghp_secret');
    expect(calls[0]?.headers?.['accept']).toBe('application/vnd.github+json');

    const anonCalls: Call[] = [];
    await githubAcquirer.acquire(
      makeSource(),
      ctxWith(bodyFetcher('[]', anonCalls)),
    );
    expect(anonCalls[0]?.headers?.['authorization']).toBeUndefined();
  });

  it('short-circuits to notModified on a 304 (ETag) without items', async () => {
    const calls: Call[] = [];
    const notModified: FeedFetcher = (url, options) => {
      calls.push({ url, headers: options.headers, etag: options.etag });
      return Promise.resolve({
        status: 304,
        notModified: true,
        body: null,
        etag: '"v1"',
        lastModified: null,
        contentType: null,
        finalUrl: url,
      });
    };
    const result = await githubAcquirer.acquire(
      makeSource({ etag: '"v1"' }),
      ctxWith(notModified),
    );
    expect(result.notModified).toBe(true);
    expect(result.items).toHaveLength(0);
    expect(result.etag).toBe('"v1"');
    // The stored ETag was sent as a conditional request.
    expect(calls[0]?.etag).toBe('"v1"');
  });

  it('stops at maxPages and when a short page is returned', async () => {
    // perPage 2, maxPages 2. Page 1 returns a full page (2), page 2 returns 1.
    const page1 = JSON.stringify([release(1), release(2)]);
    const page2 = JSON.stringify([release(3)]);
    const calls: Call[] = [];
    const paged: FeedFetcher = (url, options) => {
      calls.push({ url, headers: options.headers, etag: options.etag });
      const body = url.includes('page=1') ? page1 : page2;
      return Promise.resolve({
        status: 200,
        notModified: false,
        body,
        etag: null,
        lastModified: null,
        contentType: 'application/json',
        finalUrl: url,
      });
    };
    const result = await githubAcquirer.acquire(
      makeSource({
        source_config: { owner: 'o', repo: 'r', perPage: 2, maxPages: 2 },
      }),
      ctxWith(paged),
    );
    expect(calls).toHaveLength(2);
    expect(result.items).toHaveLength(3);
  });

  it('classifies a 403 rate-limit rejection as RATE_LIMITED', async () => {
    const rateLimited: FeedFetcher = () =>
      Promise.reject(
        new IngestError(
          'HTTP_CLIENT_ERROR',
          'Upstream client error (HTTP 403)',
          {
            retryable: false,
            httpStatus: 403,
            responseHeaders: { 'x-ratelimit-remaining': '0' },
          },
        ),
      );
    await expect(
      githubAcquirer.acquire(makeSource(), ctxWith(rateLimited)),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', retryable: true });
  });

  it('propagates a genuine 403 (not rate limited) as a client error', async () => {
    const forbidden: FeedFetcher = () =>
      Promise.reject(
        new IngestError(
          'HTTP_CLIENT_ERROR',
          'Upstream client error (HTTP 403)',
          {
            retryable: false,
            httpStatus: 403,
            responseHeaders: { 'x-ratelimit-remaining': '4999' },
          },
        ),
      );
    await expect(
      githubAcquirer.acquire(makeSource(), ctxWith(forbidden)),
    ).rejects.toMatchObject({ code: 'HTTP_CLIENT_ERROR' });
  });

  it('raises MALFORMED_FEED when the body is not a JSON array', async () => {
    const calls: Call[] = [];
    const ctx = ctxWith(bodyFetcher('{"message":"Not Found"}', calls));
    await expect(
      githubAcquirer.acquire(makeSource(), ctx),
    ).rejects.toMatchObject({
      code: 'MALFORMED_FEED',
    });
  });
});

function release(id: number) {
  return {
    id,
    html_url: `https://github.com/o/r/releases/tag/v${id}`,
    tag_name: `v${id}`,
    name: `v${id}`,
    body: 'notes',
    draft: false,
    prerelease: false,
    created_at: '2024-01-01T00:00:00Z',
    published_at: '2024-01-01T00:00:00Z',
    author: { login: 'a' },
  };
}
