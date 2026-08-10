import { AiProviderError } from './errors';
import type {
  AiProvider,
  ProviderUsage,
  StructuredRequest,
  StructuredResponse,
} from './types';

/**
 * Deterministic in-memory provider for tests and the admin smoke path.
 *
 * It performs no network I/O, so CI never depends on a live AI API. It can be
 * scripted to return a well-formed object, malformed output (to exercise strict
 * validation), non-JSON text (to exercise UNPARSEABLE_RESPONSE), or to throw a
 * classified {@link AiProviderError} (to exercise retry/failure handling). Every
 * call is recorded so tests can assert exactly what prompt was sent — crucial for
 * the prompt-injection boundary checks.
 */
export interface FakeProviderOptions {
  name?: string;
  model?: string;
  /** Parsed object to return; serialised to `raw` as JSON. */
  respondWith?: unknown;
  /** Raw string to return verbatim; parsed like a real provider reply. */
  respondRaw?: string;
  /** Throw this error instead of responding. */
  failWith?: AiProviderError;
  /** Dynamic responder; may return an object or a raw string. */
  handler?: (request: StructuredRequest) => unknown;
  usage?: ProviderUsage | null;
}

export class FakeProvider implements AiProvider {
  readonly name: string;
  readonly model: string;
  /** Every request received, in order (for prompt-boundary assertions). */
  readonly calls: StructuredRequest[] = [];

  constructor(private readonly options: FakeProviderOptions = {}) {
    this.name = options.name ?? 'fake';
    this.model = options.model ?? 'fake-1';
  }

  completeStructured(request: StructuredRequest): Promise<StructuredResponse> {
    this.calls.push(request);

    if (this.options.failWith) {
      return Promise.reject(this.options.failWith);
    }

    const produced = this.options.handler
      ? this.options.handler(request)
      : this.options.respondRaw !== undefined
        ? this.options.respondRaw
        : this.options.respondWith;

    let raw: string;
    let parsed: unknown;
    if (typeof produced === 'string') {
      raw = produced;
      try {
        parsed = JSON.parse(produced);
      } catch {
        // A real provider that promised JSON but returned prose is a
        // non-retryable provider error, not a silently-accepted blob.
        return Promise.reject(
          new AiProviderError(
            'UNPARSEABLE_RESPONSE',
            'Provider returned a non-JSON response.',
          ),
        );
      }
    } else {
      parsed = produced ?? null;
      raw = JSON.stringify(parsed);
    }

    return Promise.resolve({
      parsed,
      raw,
      provider: this.name,
      model: this.model,
      usage: this.options.usage ?? { inputTokens: 0, outputTokens: 0 },
    });
  }
}
