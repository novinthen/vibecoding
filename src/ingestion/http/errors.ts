/**
 * Ingestion fetch errors and their retryable/non-retryable classification.
 *
 * External feeds, URLs, and HTTP endpoints are untrusted input
 * (docs/ARCHITECTURE.md security boundaries). Every failure a fetch or parse can
 * produce is funnelled through {@link IngestError} so the orchestrator can record
 * a stable `error_code` in SourceFetch and derive Source health deterministically.
 *
 * Retryability is advisory metadata for a future scheduler (Stage 3 does not run
 * production polling): transient conditions (timeouts, connection resets, HTTP
 * 429/5xx) are retryable; deterministic ones (SSRF rejection, 4xx, malformed
 * feed, too many redirects, oversized body) are not — retrying cannot help.
 */

/** Stable, machine-readable failure codes recorded in SourceFetch.error_code. */
export const INGEST_ERROR_CODES = [
  'SSRF_BLOCKED',
  'INVALID_URL',
  'TIMEOUT',
  'NETWORK',
  'TOO_MANY_REDIRECTS',
  'RESPONSE_TOO_LARGE',
  'HTTP_CLIENT_ERROR',
  'HTTP_SERVER_ERROR',
  'RATE_LIMITED',
  'UNSUPPORTED_CONTENT',
  'MALFORMED_FEED',
  'EMPTY_RESPONSE',
  'UNKNOWN',
] as const;

export type IngestErrorCode = (typeof INGEST_ERROR_CODES)[number];

export interface IngestErrorOptions {
  /** Whether retrying the same request could plausibly succeed later. */
  retryable: boolean;
  /** Upstream HTTP status, when the failure carries one. */
  httpStatus?: number | null;
  /**
   * A small, non-sensitive subset of upstream response headers (e.g. rate-limit
   * counters, `retry-after`) captured so a source-specific acquirer can refine
   * the classification — for example distinguishing a GitHub 403 caused by rate
   * limiting from a genuine authorization failure. NEVER contains request
   * headers, and in particular never an Authorization/token value.
   */
  responseHeaders?: Record<string, string>;
  /** Underlying cause, preserved for logs/debugging. */
  cause?: unknown;
}

/** A classified ingestion failure. Never carries secrets in its message. */
export class IngestError extends Error {
  readonly code: IngestErrorCode;
  readonly retryable: boolean;
  readonly httpStatus: number | null;
  readonly responseHeaders: Record<string, string> | null;

  constructor(
    code: IngestErrorCode,
    message: string,
    options: IngestErrorOptions,
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'IngestError';
    this.code = code;
    this.retryable = options.retryable;
    this.httpStatus = options.httpStatus ?? null;
    this.responseHeaders = options.responseHeaders ?? null;
  }
}

/**
 * Map an HTTP status to a classified {@link IngestError}. 429 and 5xx are
 * retryable; other 4xx are not. Optional non-sensitive response headers are
 * attached so a caller can refine the classification (see
 * {@link IngestErrorOptions.responseHeaders}).
 */
export function ingestErrorFromHttpStatus(
  status: number,
  responseHeaders?: Record<string, string>,
): IngestError {
  if (status === 429) {
    return new IngestError(
      'RATE_LIMITED',
      `Upstream rate limited (HTTP ${status})`,
      {
        retryable: true,
        httpStatus: status,
        responseHeaders,
      },
    );
  }
  if (status >= 500) {
    return new IngestError(
      'HTTP_SERVER_ERROR',
      `Upstream server error (HTTP ${status})`,
      {
        retryable: true,
        httpStatus: status,
        responseHeaders,
      },
    );
  }
  return new IngestError(
    'HTTP_CLIENT_ERROR',
    `Upstream client error (HTTP ${status})`,
    {
      retryable: false,
      httpStatus: status,
      responseHeaders,
    },
  );
}

/**
 * Coerce any thrown value into a classified {@link IngestError}. Already-classified
 * errors pass through untouched; abort/timeout and low-level network errors are
 * recognised and marked retryable; everything else becomes a non-retryable
 * UNKNOWN so an unexpected bug is never silently treated as transient.
 */
export function toIngestError(error: unknown): IngestError {
  if (error instanceof IngestError) return error;

  if (error instanceof Error) {
    // AbortController-driven timeout surfaces as an AbortError.
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return new IngestError('TIMEOUT', 'Request timed out', {
        retryable: true,
        cause: error,
      });
    }
    // Node/undici network failures expose a `code` on the cause chain.
    const code = networkErrnoOf(error);
    if (code) {
      return new IngestError('NETWORK', `Network error (${code})`, {
        retryable: true,
        cause: error,
      });
    }
  }

  return new IngestError('UNKNOWN', 'Unexpected ingestion error', {
    retryable: false,
    cause: error,
  });
}

/** Retryable POSIX network errno values commonly seen from Node/undici. */
const RETRYABLE_ERRNOS = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** Walk the error/cause chain looking for a recognised network errno. */
function networkErrnoOf(error: Error): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && RETRYABLE_ERRNOS.has(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}
