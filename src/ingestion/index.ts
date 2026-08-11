/**
 * Ingestion layer barrel.
 *
 * Public entry points for the Stage 3 news-ingestion engine: the Source Adapter
 * contract, the RSS/Atom adapter, the safe fetcher, URL canonicalization and
 * hashing, health derivation, and the orchestrator. Callers depend on
 * `@/ingestion` rather than reaching into individual files.
 */
export type {
  NormalizedItem,
  ParsedFeed,
  RawFeedPayload,
  SourceAdapter,
} from './adapters/types';
export { feedAdapter } from './adapters/feed-adapter';

export {
  IngestError,
  INGEST_ERROR_CODES,
  type IngestErrorCode,
  ingestErrorFromHttpStatus,
  toIngestError,
} from './http/errors';
export {
  assertPublicUrl,
  assertSafeUrlShape,
  isPrivateAddress,
  type HostResolver,
} from './http/ssrf';
export {
  fetchFeed,
  type FeedFetcher,
  type FeedFetchOptions,
  type FeedResponse,
} from './http/fetcher';

export {
  acquireForSource,
  acquirerForSourceType,
  feedAcquirer,
  githubAcquirer,
  hackerNewsAcquirer,
  type AcquisitionContext,
  type AcquisitionResult,
  type SourceAcquirer,
} from './acquire';

export {
  canonicalizeUrl,
  tryCanonicalizeUrl,
  isTrackingParam,
  CanonicalUrlError,
} from './normalize/canonical-url';
export { urlHash, contentHash } from './normalize/hash';
export { toArticleInput, type NormalizeOptions } from './normalize/normalize';

export {
  deriveHealth,
  type HealthState,
  type FetchOutcome,
  HEALTH_DEGRADED_THRESHOLD,
  HEALTH_FAILING_THRESHOLD,
} from './health';

export {
  ingestSource,
  ingestSources,
  type IngestDeps,
  type IngestResult,
  type ArticleWriter,
  type SourceFetchWriter,
  type SourceHealthWriter,
} from './ingest';

export { REPRESENTATIVE_SOURCES, type RegistrySource } from './registry';
