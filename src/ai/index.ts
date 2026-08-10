/**
 * AI layer barrel (Stage 6).
 *
 * The AI enrichment layer: a provider-neutral boundary, a strict output schema,
 * an injection-resistant prompt builder, a read-only suggestion matcher, and the
 * enrichment service that ties them together with versioned, auditable
 * persistence. AI is optional — importing this module does not require a provider
 * to be configured; only invoking enrichment does.
 */
export * from './provider';
export {
  buildProvider,
  resolveConfiguredProvider,
  aiConfigured,
} from './config';
export {
  ENRICHMENT_SCHEMA_VERSION,
  ENRICHMENT_PROMPT_NAME,
  ENRICHMENT_PROMPT_VERSION,
  enrichmentOutputSchema,
  validateEnrichmentOutput,
  type EnrichmentOutput,
  type EnrichmentValidation,
} from './enrichment/schema';
export {
  ENRICHMENT_SYSTEM_INSTRUCTIONS,
  DEFAULT_MAX_CONTENT_CHARS,
  buildEnrichmentRequest,
  type BuildEnrichmentRequestOptions,
} from './enrichment/prompt';
export {
  resolveSuggestions,
  type ResolvedSuggestions,
  type MatchedTopic,
  type MatchedEntity,
} from './enrichment/suggestions';
export {
  enrichArticle,
  isEligibleForEnrichment,
  ArticleNotFoundError,
  EnrichmentIneligibleError,
  type EnrichArticleOptions,
  type EnrichmentResult,
} from './enrichment/service';
