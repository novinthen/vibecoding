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
 *  - a wall-clock timeout via AbortController;
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
  /** Wall-clock timeout in milliseconds (default 10s). */
  timeoutMs?: number;
  /** Maximum redirect hops to follow (default 5). */
  maxRedirects?: number;
  /** Maximum response size in bytes (default 5 MiB). */
  maxBytes?: number;
  /** User-Agent header sent with each request. */
  userAgent?: string;
  /** Injected fetch implementation (defaults to global fetch). */
  fetchImpl?: typeof fetch;
  /** Injected DNS resolver for the SSRF guard. */
  resolve?: HostResolver;
}

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

/**
 * Fetch a feed URL safely, following redirects with SSRF re-validation at each
 * hop and honouring conditional-request headers. Throws {@link IngestError}.
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

  let currentUrl = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    // SSRF guard on every hop (initial + each redirect target).
    const url = await assertPublicUrl(currentUrl, { resolve: options.resolve });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers,
      });
    } catch (error) {
      throw toIngestError(error);
    } finally {
      clearTimeout(timer);
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
      // Resolve relative redirects against the current URL.
      currentUrl = new URL(location, url).toString();
      continue;
    }

    if (response.status === 304) {
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
      throw ingestErrorFromHttpStatus(response.status);
    }

    const body = await readCapped(response, maxBytes);
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
}

/**
 * Read a response body as UTF-8 text, enforcing a hard byte cap. Rejects early
 * on an oversized Content-Length, then streams and aborts if the actual body
 * exceeds the cap.
 */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declared = response.headers.get('content-length');
  if (
    declared &&
    Number.isFinite(Number(declared)) &&
    Number(declared) > maxBytes
  ) {
    throw new IngestError(
      'RESPONSE_TOO_LARGE',
      'Declared body exceeds size cap',
      {
        retryable: false,
      },
    );
  }

  if (!response.body) {
    const text = await response.text();
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
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new IngestError('RESPONSE_TOO_LARGE', 'Body exceeds size cap', {
            retryable: false,
          });
        }
        chunks.push(Buffer.from(value));
      }
    }
  } catch (error) {
    if (error instanceof IngestError) throw error;
    throw toIngestError(error);
  }
  return Buffer.concat(chunks).toString('utf8');
}
