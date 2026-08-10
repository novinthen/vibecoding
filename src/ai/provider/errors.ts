/**
 * Provider error model (Stage 6).
 *
 * AI is optional: every failure path must leave source Articles and public
 * rendering intact and be recorded so a retry can happen safely. Errors are
 * classified as retryable (transient: timeouts, rate limits, 5xx, network) or
 * non-retryable (deterministic: misconfiguration, auth, 4xx, an unparseable
 * reply) so callers can decide whether re-running could plausibly succeed.
 *
 * `code` is a stable, safe slug for persistence and metrics. `message` must never
 * embed secrets (API keys, full prompts) — providers construct it from status
 * and category only.
 */
export type AiErrorCode =
  | 'MISCONFIGURED'
  | 'AUTH'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'SERVER'
  | 'BAD_REQUEST'
  | 'UNPARSEABLE_RESPONSE'
  | 'UNKNOWN';

/** Whether re-running the same request could plausibly succeed. */
const RETRYABLE_CODES: ReadonlySet<AiErrorCode> = new Set<AiErrorCode>([
  'RATE_LIMITED',
  'TIMEOUT',
  'NETWORK',
  'SERVER',
]);

export class AiProviderError extends Error {
  readonly code: AiErrorCode;
  readonly retryable: boolean;
  /** HTTP status when the error came from an HTTP provider (else null). */
  readonly httpStatus: number | null;

  constructor(
    code: AiErrorCode,
    message: string,
    options: { httpStatus?: number | null; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'AiProviderError';
    this.code = code;
    this.retryable = RETRYABLE_CODES.has(code);
    this.httpStatus = options.httpStatus ?? null;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** Classify an HTTP status from a provider into an error code. */
export function codeForHttpStatus(status: number): AiErrorCode {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER';
  if (status >= 400) return 'BAD_REQUEST';
  return 'UNKNOWN';
}

/** Whether an unknown thrown value is a retryable provider error. */
export function isRetryable(error: unknown): boolean {
  return error instanceof AiProviderError && error.retryable;
}
