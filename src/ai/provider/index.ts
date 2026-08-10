/**
 * AI provider boundary barrel.
 *
 * Callers depend on the {@link AiProvider} capability and the shared error model,
 * never on a concrete vendor module.
 */
export type {
  AiProvider,
  ProviderUsage,
  StructuredRequest,
  StructuredResponse,
} from './types';
export {
  AiProviderError,
  codeForHttpStatus,
  isRetryable,
  type AiErrorCode,
} from './errors';
export { FakeProvider, type FakeProviderOptions } from './fake-provider';
export {
  AnthropicProvider,
  extractJson,
  type AnthropicProviderConfig,
} from './anthropic-provider';
