import type {
  ArticleStatus,
  AuthorityTier,
  ClusteringDecision,
  ClusteringSource,
  EnrichmentStatus,
  EntityType,
  HealthStatus,
  LocalizationStatus,
  PublicationStatus,
  PublicationStoryStatus,
  RelevanceClassification,
  SourceFetchStatus,
  SourceType,
  StoryArticleRelationship,
  StoryReviewState,
  StoryStatus,
  TranslationSource,
} from './enums';

/**
 * One Publication — a public editorial brand/site. The JSONB `editorial_profile`
 * / `branding` / `seo_settings` hold flexible, publication-specific presentation
 * config (canonical intelligence stays global; publishing is publication-specific).
 */
export interface PublicationRow {
  id: string;
  name: string;
  slug: string;
  default_locale: string;
  timezone: string;
  status: PublicationStatus;
  editorial_profile: Record<string, unknown>;
  branding: Record<string, unknown>;
  seo_settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * One PublicationDomain — a hostname mapped to a Publication. Domains are
 * globally unique, and at most one per Publication may be `is_primary`.
 */
export interface PublicationDomainRow {
  id: string;
  publication_id: string;
  domain: string;
  is_primary: boolean;
  enabled: boolean;
  created_at: string;
}

/**
 * One PublicationStory — per-Publication publishing control for a canonical
 * Story. Carries only publication-specific presentation (slug/headline/summary/
 * why-it-matters/status/featured/priority); it never alters canonical Story
 * facts. Unique on (publication_id, story_id).
 */
export interface PublicationStoryRow {
  id: string;
  publication_id: string;
  story_id: string;
  status: PublicationStoryStatus;
  slug: string | null;
  headline: string | null;
  published_summary: string | null;
  published_why_it_matters: string | null;
  featured: boolean;
  editorial_priority: number;
  /** Stage 8: exclude from ranked lists without unpublishing (detail page remains accessible). */
  suppress_ranking: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One StoryLocalization — a locale-specific editorial variant of a published
 * Story, belonging to a PublicationStory (Story → PublicationStory →
 * StoryLocalization). Languages are rows keyed by `locale`, never columns.
 * Unique on (publication_story_id, locale).
 */
export interface StoryLocalizationRow {
  id: string;
  publication_story_id: string;
  locale: string;
  headline: string | null;
  summary: string | null;
  why_it_matters: string | null;
  translation_source: TranslationSource | null;
  model_provider: string | null;
  model_name: string | null;
  status: LocalizationStatus;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Row shapes for the core canonical tables exposed through the data-access
 * layer. These describe what repositories return; they intentionally cover the
 * Stage 2B read/write surface (Source, Article, Story, Entity, Topic) rather
 * than every column of every table. Timestamps are ISO strings as returned by
 * `pg` for timestamptz columns.
 */

export interface TopicRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parent_id: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface SourceRow {
  id: string;
  name: string;
  slug: string;
  homepage_url: string | null;
  feed_url: string | null;
  source_type: SourceType;
  authority_tier: AuthorityTier;
  poll_interval: number | null;
  enabled: boolean;
  language: string | null;
  default_topic_id: string | null;
  last_fetch_at: string | null;
  last_success_at: string | null;
  failure_count: number;
  health_status: HealthStatus;
  etag: string | null;
  last_modified: string | null;
  created_at: string;
  updated_at: string;
}

/** One audited fetch attempt against a Source. */
export interface SourceFetchRow {
  id: string;
  source_id: string;
  started_at: string;
  completed_at: string | null;
  status: SourceFetchStatus;
  http_status: number | null;
  items_found: number | null;
  items_new: number | null;
  items_updated: number | null;
  duration_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ArticleRow {
  id: string;
  source_id: string;
  external_id: string | null;
  url: string;
  canonical_url: string | null;
  url_hash: string | null;
  original_title: string;
  normalized_title: string | null;
  original_excerpt: string | null;
  clean_text: string | null;
  author: string | null;
  published_at: string | null;
  source_updated_at: string | null;
  discovered_at: string;
  image_url: string | null;
  language: string | null;
  content_hash: string | null;
  status: ArticleStatus;
  created_at: string;
  updated_at: string;
}

export interface StoryRow {
  id: string;
  slug: string;
  canonical_title: string;
  summary: string | null;
  why_it_matters: string | null;
  primary_topic_id: string | null;
  status: StoryStatus;
  first_published_at: string | null;
  last_activity_at: string | null;
  primary_article_id: string | null;
  importance_score: number | null;
  trending_score: number | null;
  confidence: number | null;
  /** Stage 7 clustering review state; protects editor decisions from auto-changes. */
  review_state: StoryReviewState;
  /** Whether the Story was first formed by the clustering engine or an editor. */
  formation_source: ClusteringSource;
  clustering_method: string | null;
  clustering_version: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One Story <-> Article membership row (Stage 7 provenance included). Source
 * facts are never here; the clustering annotations (score/reason/signals/method)
 * explain WHY the Article is attached, as reviewable derived evidence.
 */
export interface StoryArticleRow {
  story_id: string;
  article_id: string;
  relationship_type: StoryArticleRelationship;
  confidence: number | null;
  assignment_source: string | null;
  clustering_method: string | null;
  clustering_version: string | null;
  score: number | null;
  decision_reason: string | null;
  signals: Record<string, unknown> | null;
  created_at: string;
}

/**
 * One embedding record — DERIVED data kept out of Article/Story source fields.
 * `provider`/`model`/`embedding_version` give it explicit provenance;
 * `source_content_hash` is the hash of the exact text embedded, so a stale
 * embedding (its source text changed) can be detected and refreshed. The
 * `embedding` vector is returned by `pg` as a string like "[0.1,0.2,...]".
 */
export interface ArticleEmbeddingRow {
  id: string;
  article_id: string;
  provider: string | null;
  model: string;
  embedding_version: number;
  dimensions: number;
  embedding: string;
  source_content_hash: string | null;
  created_at: string;
}

export interface StoryEmbeddingRow {
  id: string;
  story_id: string;
  provider: string | null;
  model: string;
  embedding_version: number;
  dimensions: number;
  embedding: string;
  source_content_hash: string | null;
  created_at: string;
}

/** One scored candidate considered during a clustering attempt (for review). */
export interface ClusteringCandidateRecord {
  storyId: string;
  /** The Story's representative Article the comparison scored against, if any. */
  representativeArticleId: string | null;
  score: number;
  passesThreshold: boolean;
  signals: Record<string, number | null>;
  /** How this candidate surfaced (e.g. "embedding", "entity", "time-window"). */
  sources: string[];
}

/**
 * One clustering decision — an append-only, auditable record of a single
 * clustering attempt for an Article. It records the method/version, embedding
 * provenance, the outcome, the chosen Story (if any), the top score/confidence,
 * and the full scored candidate set, so an editor can review exactly what was
 * considered and why. Clustering NEVER mutates Article source facts; this log is
 * derived evidence only.
 */
export interface ClusteringDecisionRow {
  id: string;
  article_id: string;
  story_id: string | null;
  method: string;
  method_version: string;
  embedding_provider: string | null;
  embedding_model: string | null;
  embedding_version: number | null;
  decision: ClusteringDecision;
  decision_source: ClusteringSource;
  top_score: number | null;
  confidence: number | null;
  candidate_count: number;
  reason: string | null;
  candidates: ClusteringCandidateRecord[];
  signals: Record<string, number | null> | null;
  created_at: string;
}

export interface EntityRow {
  id: string;
  entity_type: EntityType;
  name: string;
  slug: string;
  description: string | null;
  homepage_url: string | null;
  github_url: string | null;
  logo_url: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * One suggested Topic candidate produced by AI enrichment. A candidate is NEVER
 * a canonical Topic: it is raw advisory output. `slug` is the model's guess only;
 * canonical resolution happens in the deterministic matching layer.
 */
export interface SuggestedTopic {
  name: string;
  slug: string | null;
  confidence: number | null;
}

/** One suggested Entity/tool/company candidate produced by AI enrichment. */
export interface SuggestedEntity {
  name: string;
  entity_type: EntityType | null;
  confidence: number | null;
}

/** Token/cost metadata reported by a provider for one enrichment call. */
export interface EnrichmentUsage {
  input_tokens?: number;
  output_tokens?: number;
  [key: string]: unknown;
}

/**
 * One versioned ArticleEnrichment row — AI-derived output kept strictly separate
 * from canonical Article source facts (never overwrites them). Each attempt is an
 * immutable version; re-running creates a new one, preserving prior provenance.
 * `structured_output` holds the raw parsed model result for audit/debugging, even
 * for failed/invalid attempts. AI output here is advisory: it is not published or
 * promoted into any canonical field by its mere existence.
 */
export interface ArticleEnrichmentRow {
  id: string;
  article_id: string;
  model_provider: string;
  model_name: string;
  prompt_name: string | null;
  prompt_version: string | null;
  schema_version: string | null;
  enrichment_version: number;
  status: EnrichmentStatus;
  relevance: RelevanceClassification | null;
  relevance_reason: string | null;
  summary: string | null;
  why_it_matters: string | null;
  relevance_score: number | null;
  importance_score: number | null;
  technical_depth: number | null;
  novelty_score: number | null;
  confidence: number | null;
  suggested_topics: SuggestedTopic[];
  suggested_entities: SuggestedEntity[];
  usage: EnrichmentUsage | null;
  structured_output: Record<string, unknown> | null;
  validation_error: string | null;
  error_code: string | null;
  error_message: string | null;
  generated_at: string;
  created_at: string;
}

/**
 * One admin/editorial audit record. The target is polymorphic
 * (target_type + target_id) with no FK, so audit history survives deletion of
 * the object it describes. `before`/`after` capture relevant state for the
 * change; `metadata` holds action-specific context.
 */
export interface AdminAuditLogRow {
  id: string;
  actor_id: string | null;
  actor_identifier: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
