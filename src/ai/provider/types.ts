/**
 * Provider-neutral contract for structured AI tasks (Stage 6).
 *
 * Domain code depends on this capability — "given trusted instructions plus a
 * block of untrusted input, return a single JSON object" — never on a specific
 * vendor. Swapping providers means implementing this interface; nothing else in
 * the codebase changes. The boundary is deliberately narrow: no free-form chat,
 * no tool calling, no streaming — only structured extraction, which is all the
 * enrichment layer needs.
 */

/**
 * One structured task. `system` is trusted task/schema instruction text authored
 * by us. `input` is UNTRUSTED data (Article/source text) and must be treated as
 * data, never as instructions — providers place it in a position that cannot
 * override the system role. The two are kept as separate fields precisely so a
 * caller can never accidentally concatenate untrusted text into the instructions.
 */
export interface StructuredRequest {
  /** Trusted system/task instructions (includes the output-schema description). */
  system: string;
  /** Untrusted input payload (e.g. delimited Article source facts). */
  input: string;
  /** Stable name of the task/schema, for provider-side logging. */
  schemaName: string;
  /** Upper bound on output tokens (cost control). */
  maxOutputTokens?: number;
  /** Sampling temperature; enrichment defaults to deterministic-leaning. */
  temperature?: number;
}

/** Token/cost usage reported by a provider, when available. */
export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * A provider's reply. `parsed` is the JSON object the provider returned (already
 * `JSON.parse`d from `raw`); it is UNVALIDATED — the enrichment layer validates
 * it against a strict schema before anything is persisted or trusted. `raw` is
 * retained for audit/debugging.
 */
export interface StructuredResponse {
  parsed: unknown;
  raw: string;
  provider: string;
  model: string;
  usage: ProviderUsage | null;
}

/**
 * A structured-AI provider. Implementations MUST:
 *  - throw {@link AiProviderError} (classified retryable/non-retryable) on any
 *    failure, never a bare Error or a half-formed response;
 *  - return `parsed` as valid JSON (throwing UNPARSEABLE_RESPONSE otherwise);
 *  - never read Article source facts except via the caller-supplied `input`.
 */
export interface AiProvider {
  /** Stable provider slug persisted as model_provider (e.g. "fake", "anthropic"). */
  readonly name: string;
  /** Model identifier persisted as model_name. */
  readonly model: string;
  completeStructured(request: StructuredRequest): Promise<StructuredResponse>;
}
