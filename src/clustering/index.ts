/**
 * Story clustering layer (Stage 7) — public surface.
 *
 * Groups Articles that describe the same underlying event into canonical Stories
 * while preserving every Article as independent evidence (Article != Story). The
 * layer is deterministic and provider-neutral: embeddings come from an
 * {@link EmbeddingProvider} boundary (fake by default, no live API in CI), scoring
 * is a versioned multi-signal formula, and every attempt is recorded as an
 * auditable ClusteringDecision. It never mutates Article source facts, never
 * publishes, and biases to false-split over false-merge.
 */
export {
  clusterArticle,
  isEligibleForClustering,
  CLUSTERING_METHOD,
  CLUSTERING_LOCK_NAMESPACE,
  type ClusterArticleOptions,
  type ClusterArticleDeps,
  type ClusterArticleResult,
} from './assignment';
export {
  ClusterArticleNotFoundError,
  ClusteringIneligibleError,
} from './errors';
export {
  SCORING_VERSION,
  ASSIGN_THRESHOLD,
  AMBIGUITY_MARGIN,
  WEIGHTS,
  rankCandidates,
  scoreCandidate,
  selectAssignment,
  cosineSimilarity,
  temporalScore,
  type ArticleFeatures,
  type CandidateFeatures,
  type CandidateScore,
  type RankedCandidate,
  type Selection,
} from './scoring';
export {
  generateCandidates,
  parseVector,
  DEFAULT_CANDIDATE_OPTIONS,
  type CandidateOptions,
} from './candidates';
export { tokenize, tokenSet, jaccard } from './tokens';
export { resolveEmbeddingProvider } from './embedding/config';
export { FakeEmbeddingProvider } from './embedding/fake-provider';
export { ensureArticleEmbedding } from './embedding/service';
export {
  articleEmbeddingText,
  embeddingContentHash,
  MAX_EMBEDDING_CHARS,
} from './embedding/text';
export type { EmbeddingProvider } from './embedding/types';
