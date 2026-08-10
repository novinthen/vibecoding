import { AiProviderError, codeForHttpStatus } from './errors';
import type {
  AiProvider,
  StructuredRequest,
  StructuredResponse,
} from './types';

/**
 * Thin Anthropic Messages API adapter (Stage 6).
 *
 * Implemented directly over `fetch` — no vendor SDK dependency (CLAUDE.md:
 * prefer minimal dependencies) — and instantiated ONLY when the AI surface is
 * configured, so nothing here runs in ordinary CI. It is the single concrete
 * provider Stage 6 ships; every other module depends on {@link AiProvider}, so
 * the vendor boundary stays clean.
 *
 * Security posture: the API key is server-only (resolved from env, never bundled
 * to the client) and never appears in any error message or log line. The
 * untrusted `input` is sent as a user message, strictly separate from the trusted
 * `system` instructions, so Article text cannot escalate into instructions.
 */
export interface AnthropicProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** Request timeout in milliseconds (defaults to 30s). */
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_TIMEOUT_MS = 30_000;

interface AnthropicMessagesResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AnthropicProviderConfig) {
    if (!config.apiKey) {
      throw new AiProviderError(
        'MISCONFIGURED',
        'Anthropic provider requires an API key.',
      );
    }
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async completeStructured(
    request: StructuredRequest,
  ): Promise<StructuredResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: request.maxOutputTokens ?? 1024,
          temperature: request.temperature ?? 0,
          system: request.system,
          messages: [{ role: 'user', content: request.input }],
        }),
        signal: controller.signal,
      });
    } catch (error) {
      // AbortError => our timeout fired; anything else is a transport failure.
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new AiProviderError(
        aborted ? 'TIMEOUT' : 'NETWORK',
        aborted
          ? 'Anthropic request timed out.'
          : 'Anthropic request failed to reach the provider.',
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // Body may carry provider detail, but it can echo request content; keep the
      // surfaced message generic (status only) to avoid leaking prompt/secret.
      throw new AiProviderError(
        codeForHttpStatus(response.status),
        `Anthropic request failed with HTTP ${response.status}.`,
        { httpStatus: response.status },
      );
    }

    let body: AnthropicMessagesResponse;
    try {
      body = (await response.json()) as AnthropicMessagesResponse;
    } catch (error) {
      throw new AiProviderError(
        'UNPARSEABLE_RESPONSE',
        'Anthropic response envelope was not valid JSON.',
        { cause: error },
      );
    }

    const text = (body.content ?? [])
      .filter(
        (block) => block.type === 'text' && typeof block.text === 'string',
      )
      .map((block) => block.text as string)
      .join('')
      .trim();

    if (!text) {
      throw new AiProviderError(
        'UNPARSEABLE_RESPONSE',
        'Anthropic response contained no text content.',
      );
    }

    const parsed = extractJson(text);
    if (parsed === undefined) {
      throw new AiProviderError(
        'UNPARSEABLE_RESPONSE',
        'Anthropic response did not contain a JSON object.',
      );
    }

    return {
      parsed,
      raw: text,
      provider: this.name,
      model: this.model,
      usage: {
        inputTokens: body.usage?.input_tokens,
        outputTokens: body.usage?.output_tokens,
      },
    };
  }
}

/**
 * Best-effort extraction of a single JSON object from model text. Tries the whole
 * string first, then a ```json fenced block, then the outermost brace span. This
 * only PARSES; the strict schema validation downstream is what decides whether
 * the shape is acceptable. Returns `undefined` when no JSON object can be parsed.
 */
export function extractJson(text: string): unknown {
  const candidates: string[] = [text];

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence?.[1]) candidates.push(fence[1].trim());

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) {
    candidates.push(text.slice(first, last + 1));
  }

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object') return value;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}
