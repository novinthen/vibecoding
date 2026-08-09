import type {
  ArticleStatus,
  AuthorityTier,
  EntityType,
  HealthStatus,
  SourceFetchStatus,
  SourceType,
  StoryStatus,
} from './enums';

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
  created_at: string;
  updated_at: string;
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
