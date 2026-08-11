import { describe, expect, it } from 'vitest';

import { fetchFeed, IngestError } from '@/ingestion';

/** A resolver that keeps every host public so SSRF never blocks these tests. */
const publicResolve = async () => ['93.184.216.34'];

type Call = { url: string; init: RequestInit };

/** Build a fake fetch that returns queued responses and records calls. */
function fakeFetch(responses: Response[]): {
  fn: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  let i = 0;
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const res = responses[i];
    i += 1;
    if (!res) throw new Error('no queued response');
    return res;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('fetchFeed — success', () => {
  it('returns body and validators from a 200 response', async () => {
    const { fn } = fakeFetch([
      new Response('<rss></rss>', {
        status: 200,
        headers: {
          'content-type': 'application/rss+xml',
          etag: '"abc"',
          'last-modified': 'Wed, 06 Aug 2025 10:00:00 GMT',
        },
      }),
    ]);
    const res = await fetchFeed('https://example.com/feed', {
      fetchImpl: fn,
      resolve: publicResolve,
    });
    expect(res.status).toBe(200);
    expect(res.body).toBe('<rss></rss>');
    expect(res.etag).toBe('"abc"');
    expect(res.lastModified).toBe('Wed, 06 Aug 2025 10:00:00 GMT');
    expect(res.notModified).toBe(false);
  });
});

describe('fetchFeed — conditional requests', () => {
  it('sends If-None-Match / If-Modified-Since and short-circuits on 304', async () => {
    const { fn, calls } = fakeFetch([new Response(null, { status: 304 })]);
    const res = await fetchFeed('https://example.com/feed', {
      etag: '"abc"',
      lastModified: 'Wed, 06 Aug 2025 10:00:00 GMT',
      fetchImpl: fn,
      resolve: publicResolve,
    });
    expect(res.notModified).toBe(true);
    expect(res.body).toBeNull();
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('if-none-match')).toBe('"abc"');
    expect(headers.get('if-modified-since')).toBe(
      'Wed, 06 Aug 2025 10:00:00 GMT',
    );
  });
});

describe('fetchFeed — redirects', () => {
  it('follows redirects up to the limit and re-validates each hop', async () => {
    const { fn, calls } = fakeFetch([
      new Response(null, {
        status: 301,
        headers: { location: 'https://example.com/final' },
      }),
      new Response('<rss/>', { status: 200 }),
    ]);
    const res = await fetchFeed('https://example.com/start', {
      fetchImpl: fn,
      resolve: publicResolve,
    });
    expect(res.status).toBe(200);
    expect(res.finalUrl).toBe('https://example.com/final');
    expect(calls).toHaveLength(2);
  });

  it('rejects when the redirect limit is exceeded', async () => {
    const { fn } = fakeFetch([
      new Response(null, {
        status: 302,
        headers: { location: 'https://example.com/a' },
      }),
      new Response(null, {
        status: 302,
        headers: { location: 'https://example.com/b' },
      }),
      new Response(null, {
        status: 302,
        headers: { location: 'https://example.com/c' },
      }),
    ]);
    await expect(
      fetchFeed('https://example.com/start', {
        fetchImpl: fn,
        resolve: publicResolve,
        maxRedirects: 1,
      }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REDIRECTS' });
  });

  it('blocks a redirect that targets a private address (SSRF)', async () => {
    const { fn } = fakeFetch([
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data' },
      }),
    ]);
    await expect(
      fetchFeed('https://example.com/start', {
        fetchImpl: fn,
        resolve: publicResolve,
      }),
    ).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
  });

  it('drops the Authorization header on a cross-origin redirect (token leak)', async () => {
    const { fn, calls } = fakeFetch([
      new Response(null, {
        status: 302,
        headers: { location: 'https://evil.example.net/steal' },
      }),
      new Response('{}', { status: 200 }),
    ]);
    await fetchFeed('https://api.github.com/repos/o/r/releases', {
      fetchImpl: fn,
      resolve: publicResolve,
      headers: { authorization: 'Bearer ghp_secret' },
    });
    // First hop (same origin) carries the token; the cross-origin hop does not.
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe(
      'Bearer ghp_secret',
    );
    expect(new Headers(calls[1]?.init.headers).get('authorization')).toBeNull();
  });

  it('keeps the Authorization header on a same-origin redirect', async () => {
    const { fn, calls } = fakeFetch([
      new Response(null, {
        status: 302,
        headers: {
          location: 'https://api.github.com/repos/o/r/releases?page=2',
        },
      }),
      new Response('[]', { status: 200 }),
    ]);
    await fetchFeed('https://api.github.com/repos/o/r/releases', {
      fetchImpl: fn,
      resolve: publicResolve,
      headers: { authorization: 'Bearer ghp_secret' },
    });
    expect(new Headers(calls[1]?.init.headers).get('authorization')).toBe(
      'Bearer ghp_secret',
    );
  });
});

describe('fetchFeed — custom headers', () => {
  it('merges caller headers over the defaults (case-insensitively)', async () => {
    const { fn, calls } = fakeFetch([new Response('{}', { status: 200 })]);
    await fetchFeed('https://api.github.com/x', {
      fetchImpl: fn,
      resolve: publicResolve,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('accept')).toBe('application/vnd.github+json');
    expect(headers.get('x-github-api-version')).toBe('2022-11-28');
  });
});

describe('fetchFeed — HTTP errors', () => {
  it('maps 5xx to a retryable server error', async () => {
    const { fn } = fakeFetch([new Response('nope', { status: 503 })]);
    await expect(
      fetchFeed('https://example.com/feed', {
        fetchImpl: fn,
        resolve: publicResolve,
      }),
    ).rejects.toMatchObject({ code: 'HTTP_SERVER_ERROR', retryable: true });
  });

  it('maps 404 to a non-retryable client error', async () => {
    const { fn } = fakeFetch([new Response('nope', { status: 404 })]);
    await expect(
      fetchFeed('https://example.com/feed', {
        fetchImpl: fn,
        resolve: publicResolve,
      }),
    ).rejects.toMatchObject({ code: 'HTTP_CLIENT_ERROR', retryable: false });
  });

  it('captures rate-limit response headers on a 4xx error', async () => {
    const { fn } = fakeFetch([
      new Response('rate limited', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'retry-after': '60' },
      }),
    ]);
    await expect(
      fetchFeed('https://api.github.com/x', {
        fetchImpl: fn,
        resolve: publicResolve,
      }),
    ).rejects.toMatchObject({
      code: 'HTTP_CLIENT_ERROR',
      responseHeaders: { 'x-ratelimit-remaining': '0', 'retry-after': '60' },
    });
  });
});

describe('fetchFeed — timeout', () => {
  it('aborts and classifies a timeout', async () => {
    const slowFetch = ((url: string | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    }) as unknown as typeof fetch;

    await expect(
      fetchFeed('https://example.com/feed', {
        fetchImpl: slowFetch,
        resolve: publicResolve,
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });
  });
});

describe('fetchFeed — body stalls after headers', () => {
  it('aborts and classifies as TIMEOUT when the body never streams', async () => {
    // Headers arrive (fetch resolves with 200) but the body stream never emits
    // and never closes — the classic "slowloris" body stall.
    const stalled = new ReadableStream<Uint8Array>({
      start() {
        /* never enqueue, never close */
      },
    });
    const { fn } = fakeFetch([
      new Response(stalled, {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      }),
    ]);
    await expect(
      fetchFeed('https://example.com/feed', {
        fetchImpl: fn,
        resolve: publicResolve,
        timeoutMs: 30,
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });
  });
});

describe('fetchFeed — size cap', () => {
  it('rejects a body larger than the cap', async () => {
    const big = 'a'.repeat(1000);
    const { fn } = fakeFetch([new Response(big, { status: 200 })]);
    await expect(
      fetchFeed('https://example.com/feed', {
        fetchImpl: fn,
        resolve: publicResolve,
        maxBytes: 100,
      }),
    ).rejects.toBeInstanceOf(IngestError);
  });

  it('rejects on an oversized declared Content-Length', async () => {
    const { fn } = fakeFetch([
      new Response('small', {
        status: 200,
        headers: { 'content-length': '999999' },
      }),
    ]);
    await expect(
      fetchFeed('https://example.com/feed', {
        fetchImpl: fn,
        resolve: publicResolve,
        maxBytes: 100,
      }),
    ).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
  });
});

describe('fetchFeed — SSRF on the initial URL', () => {
  it('never calls fetch when the target is a blocked host', async () => {
    const { fn, calls } = fakeFetch([new Response('x', { status: 200 })]);
    await expect(
      fetchFeed('http://localhost/feed', {
        fetchImpl: fn,
        resolve: publicResolve,
      }),
    ).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
    expect(calls).toHaveLength(0);
  });
});
