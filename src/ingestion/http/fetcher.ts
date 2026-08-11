import {
  IngestError,
  ingestErrorFromHttpStatus,
  toIngestError,
} from './errors';
import { assertPublicUrl, type HostResolver } from './ssrf';

/**
 * Safe HTTP fetching for feeds.
 *
 * Feed endpoints are untrusted, so every fetch enforces defensive limits
 * (docs/ARCHITECTURE.md security boundaries):
 *  - a wall-clock timeout that bounds the WHOLE operation — DNS/SSRF validation,
 *    connection, every redirect hop, AND body streaming — not just the wait for
 *    response headers. A server that sends headers and then stalls the body is
 *    still aborted;
 *  - a bounded redirect chain, followed manually so each hop is re-validated;
 *  - SSRF protection on the initial URL and on every redirect target;
 *  - conditional requests (ETag / Last-Modified) to avoid re-downloading
 *    unchanged feeds — a 304 short-circuits to `notModified`;
 *  - a hard response-size cap streamed from the body, so a hostile source cannot
 *    exhaust memory.
 *
 * Failures are raised as classified {@link IngestError}s; the orchestrator turns
 * those into SourceFetch audit rows and Source-health transitions. The `fetchImpl`
 * and `resolve` seams keep the whole thing deterministically testable without a
 * network.
 */

export interface FeedFetchOptions {
  /** Stored ETag to send as If-None-Match. */
  etag?: string | null;
  /** Stored Last-Modified to send as If-Modified-Since. */
  lastModified?: string | null;
  /** Wall-clock timeout in milliseconds for the whole operation (default 10s). */
  timeoutMs?: number;
  /** Maximum redirect hops to follow (default 5). */
  maxRedirects?: number;
  /** Maximum response size in bytes (default 5 MiB). */
  maxBytes?: number;
  /** User-Agent header sent with each request. */
  userAgent?: string;
  /**
   * Extra request headers merged (case-insensitively) over the defaults. Used by
   * non-feed acquirers to set a JSON `Accept`, a provider API version, or an
   * `Authorization` credential. An `authorization` header is automatically
   * dropped before following a redirect to a different origin, so a provider
   * token can never leak to a redirected host.
   */
  headers?: Record<string, string>;
  /** Injected fetch implementation (defaults to global fetch). */
  fetchImpl?: typeof fetch;
  /** Injected DNS resolver for the SSRF guard. */
  resolve?: HostResolver;
}

/**
 * The fetch seam every acquirer depends on: given a URL and options, resolve a
 * safe {@link FeedResponse}. Satisfied by {@link fetchFeed}; injected as a fake
 * in tests so acquisition is deterministic without a network.
 */
export type FeedFetcher = (
  url: string,
  options: FeedFetchOptions,
) => Promise<FeedResponse>;

export interface FeedResponse {
  /** Final HTTP status of the terminal (non-redirect) response. */
  status: number;
  /** True when the server answered 304 Not Modified. */
  notModified: boolean;
  /** Response body text, or null for a 304. */
  body: string | null;
  /** ETag returned by the server, or null. */
  etag: string | null;
  /** Last-Modified returned by the server, or null. */
  lastModified: string | null;
  /** Content-Type returned by the server, or null. */
  contentType: string | null;
  /** URL of the terminal response after any redirects. */
  finalUrl: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_USER_AGENT = 'VibeCodingNewsBot/0.1 (+ingestion)';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** An AbortError-shaped error so {@link toIngestError} classifies it as TIMEOUT. */
function timeoutError(): Error {
  const error = new Error('Operation timed out');
  error.name = 'AbortError';
  return error;
}

/**
 * Fetch a feed URL safely, following redirects with SSRF re-validation at each
 * hop and honouring conditional-request headers. A single timeout bounds the
 * entire operation, including body streaming. Throws {@link IngestError}.
 */
export async function fetchFeed(
  rawUrl: string,
  options: FeedFetchOptions = {},
): Promise<FeedResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const fetchImpl = options.fetchImpl ?? fetch;

  const headers: Record<string, string> = {
    'user-agent': userAgent,
    accept:
      'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
    'accept-encoding': 'gzip, deflate, br',
  };
  if (options.etag) headers['if-none-match'] = options.etag;
  if (options.lastModified) headers['if-modified-since'] = options.lastModified;
  // Caller-supplied headers override defaults (case-insensitively), enabling a
  // JSON Accept, a provider API version, or an Authorization credential.
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      headers[key.toLowerCase()] = value;
    }
  }

  // One controller + timer bounds the whole operation. The signal is passed to
  // every fetch hop, and `aborted` lets awaited steps that fetch cannot cancel
  // on its own (DNS resolution, body streaming from a fake stream) race the
  // timeout too. `aborted` carries its own catch so a late abort after we have
  // already returned never surfaces as an unhandled rejection.
  const controller = new AbortController();
  const signal = controller.signal;
  const aborted = new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(timeoutError());
      return;
    }
    signal.addEventListener('abort', () => reject(timeoutError()), {
      once: true,
    });
  });
  aborted.catch(() => {});
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let currentUrl = rawUrl;
    let initialOrigin: string | null = null;
    // Once a redirect crosses an origin boundary, an Authorization credential is
    // never sent again — a provider token must not reach a redirected host.
    let stripAuthorization = false;

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      // SSRF guard on every hop (initial + each redirect target). Raced against
      // the timeout because DNS resolution cannot be aborted by the signal.
      const url = await Promise.race([
        assertPublicUrl(currentUrl, { resolve: options.resolve }),
        aborted,
      ]);
      if (initialOrigin === null) initialOrigin = url.origin;

      // A fresh per-hop header set (never a shared mutable object) so a stripped
      // credential on a later hop cannot retroactively affect an earlier one.
      const hopHeaders = { ...headers };
      if (stripAuthorization) delete hopHeaders['authorization'];

      let response: Response;
      try {
        response = await fetchImpl(url.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal,
          headers: hopHeaders,
        });
      } catch (error) {
        throw toIngestError(error);
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new IngestError(
            'NETWORK',
            `Redirect (${response.status}) without Location header`,
            { retryable: false, httpStatus: response.status },
          );
        }
        // Drain/close the redirect response body before the next hop.
        await response.body?.cancel().catch(() => {});
        // Resolve relative redirects against the current URL.
        const nextUrl = new URL(location, url);
        // Never carry an Authorization credential across an origin boundary — a
        // redirect to a different host must not receive a provider token.
        if (nextUrl.origin !== initialOrigin) {
          stripAuthorization = true;
        }
        currentUrl = nextUrl.toString();
        continue;
      }

      if (response.status === 304) {
        await response.body?.cancel().catch(() => {});
        return {
          status: 304,
          notModified: true,
          body: null,
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('last-modified'),
          contentType: response.headers.get('content-type'),
          finalUrl: url.toString(),
        };
      }

      if (response.status >= 400) {
        await response.body?.cancel().catch(() => {});
        throw ingestErrorFromHttpStatus(
          response.status,
          rateLimitHeaders(response.headers),
        );
      }

      const body = await readCapped(response, maxBytes, aborted);
      return {
        status: response.status,
        notModified: false,
        body,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        contentType: response.headers.get('content-type'),
        finalUrl: url.toString(),
      };
    }

    throw new IngestError(
      'TOO_MANY_REDIRECTS',
      `Exceeded ${maxRedirects} redirects`,
      { retryable: false },
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract a small, non-sensitive subset of response headers used to classify
 * rate limiting on an error response (e.g. GitHub's `x-ratelimit-*` counters and
 * the standard `retry-after`). Deliberately allow-listed so no opaque or
 * sensitive header is ever attached to a thrown error.
 */
function rateLimitHeaders(headers: Headers): Record<string, string> {
  const allow = [
    'retry-after',
    'x-ratelimit-remaining',
    'x-ratelimit-limit',
    'x-ratelimit-reset',
    'x-ratelimit-used',
    'x-ratelimit-resource',
  ];
  const out: Record<string, string> = {};
  for (const name of allow) {
    const value = headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}

/**
 * Read a response body as UTF-8 text, enforcing a hard byte cap AND the caller's
 * timeout. Rejects early on an oversized Content-Length, then streams — racing
 * each chunk read against `aborted` so a body that stalls mid-stream is aborted
 * rather than hanging. The reader is always cancelled/released on every exit
 * path so no stream or lock leaks.
 */
async function readCapped(
  response: Response,
  maxBytes: number,
  aborted: Promise<never>,
): Promise<string> {
  const declared = response.headers.get('content-length');
  if (
    declared &&
    Number.isFinite(Number(declared)) &&
    Number(declared) > maxBytes
  ) {
    await response.body?.cancel().catch(() => {});
    throw new IngestError(
      'RESPONSE_TOO_LARGE',
      'Declared body exceeds size cap',
      { retryable: false },
    );
  }

  if (!response.body) {
    const text = await Promise.race([response.text(), aborted]);
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new IngestError('RESPONSE_TOO_LARGE', 'Body exceeds size cap', {
        retryable: false,
      });
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      // Race the read against the timeout: a stalled body loses to `aborted`.
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          throw new IngestError('RESPONSE_TOO_LARGE', 'Body exceeds size cap', {
            retryable: false,
          });
        }
        chunks.push(Buffer.from(value));
      }
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (error) {
    if (error instanceof IngestError) throw error;
    throw toIngestError(error);
  } finally {
    // Always cancel; safe whether the read completed, threw, or was aborted.
    await reader.cancel().catch(() => {});
  }
}
