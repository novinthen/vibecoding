import type {
  ArticleEnrichmentRow,
  ArticleRow,
  ClusteringDecisionRow,
  PublicationDomainRow,
  PublicationRow,
  PublicationStoryRow,
  SourceRow,
  StoryLocalizationRow,
  StoryRow,
  TopicRow,
} from '@/domain/types';

/**
 * Compact, audit-friendly projections of domain rows.
 *
 * The audit log stores relevant before/after state, not entire rows — enough to
 * reconstruct what changed without copying volatile operational counters or
 * opaque validators that add noise. None of these fields are secrets.
 */

export function auditSourceView(row: SourceRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    source_type: row.source_type,
    authority_tier: row.authority_tier,
    homepage_url: row.homepage_url,
    feed_url: row.feed_url,
    language: row.language,
    poll_interval: row.poll_interval,
    default_topic_id: row.default_topic_id,
    enabled: row.enabled,
    health_status: row.health_status,
  };
}

export function auditArticleView(row: ArticleRow): Record<string, unknown> {
  return {
    id: row.id,
    source_id: row.source_id,
    status: row.status,
    canonical_url: row.canonical_url,
  };
}

export function auditTopicView(row: TopicRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    parent_id: row.parent_id,
    enabled: row.enabled,
  };
}

export function auditPublicationView(
  row: PublicationRow,
): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    default_locale: row.default_locale,
    timezone: row.timezone,
    status: row.status,
    editorial_profile: row.editorial_profile,
    branding: row.branding,
    seo_settings: row.seo_settings,
  };
}

export function auditDomainView(
  row: PublicationDomainRow,
): Record<string, unknown> {
  return {
    id: row.id,
    publication_id: row.publication_id,
    domain: row.domain,
    is_primary: row.is_primary,
    enabled: row.enabled,
  };
}

/**
 * PublicationStory audit view — presentation only. Deliberately excludes any
 * canonical Story fact; it records the per-Publication editorial projection so a
 * change is auditable without implying canonical facts were touched.
 */
export function auditPublicationStoryView(
  row: PublicationStoryRow,
): Record<string, unknown> {
  return {
    id: row.id,
    publication_id: row.publication_id,
    story_id: row.story_id,
    status: row.status,
    slug: row.slug,
    headline: row.headline,
    published_summary: row.published_summary,
    published_why_it_matters: row.published_why_it_matters,
    featured: row.featured,
    editorial_priority: row.editorial_priority,
    published_at: row.published_at,
  };
}

/**
 * ArticleEnrichment audit view (Stage 6). Records the derived-data provenance of
 * an enrichment attempt — provider/model/version/status/relevance — never any
 * Article source fact. Excludes verbose summary/why-it-matters/raw output to keep
 * the audit trail compact; the enrichment row itself holds the full detail.
 */
export function auditEnrichmentView(
  row: ArticleEnrichmentRow,
): Record<string, unknown> {
  return {
    id: row.id,
    article_id: row.article_id,
    enrichment_version: row.enrichment_version,
    status: row.status,
    relevance: row.relevance,
    model_provider: row.model_provider,
    model_name: row.model_name,
    prompt_version: row.prompt_version,
    schema_version: row.schema_version,
    confidence: row.confidence,
  };
}

/**
 * Story audit view (Stage 7). Records canonical Story provenance and clustering
 * review state — never a per-Publication editorial projection. `canonical_title`
 * is a provisional, evidence-based value; recording it keeps membership/review
 * changes auditable without implying it is permanent truth.
 */
export function auditStoryView(row: StoryRow): Record<string, unknown> {
  return {
    id: row.id,
    slug: row.slug,
    canonical_title: row.canonical_title,
    status: row.status,
    review_state: row.review_state,
    formation_source: row.formation_source,
    primary_article_id: row.primary_article_id,
    clustering_method: row.clustering_method,
    clustering_version: row.clustering_version,
  };
}

/**
 * ClusteringDecision audit view (Stage 7). Records the derived provenance of one
 * clustering attempt — method/version, outcome, chosen Story, score/confidence —
 * never an Article source fact. Excludes the full candidate array to keep the
 * audit trail compact; the decision row itself holds it.
 */
export function auditClusteringDecisionView(
  row: ClusteringDecisionRow,
): Record<string, unknown> {
  return {
    id: row.id,
    article_id: row.article_id,
    story_id: row.story_id,
    method: row.method,
    method_version: row.method_version,
    decision: row.decision,
    decision_source: row.decision_source,
    top_score: row.top_score,
    confidence: row.confidence,
    candidate_count: row.candidate_count,
  };
}

export function auditLocalizationView(
  row: StoryLocalizationRow,
): Record<string, unknown> {
  return {
    id: row.id,
    publication_story_id: row.publication_story_id,
    locale: row.locale,
    headline: row.headline,
    summary: row.summary,
    why_it_matters: row.why_it_matters,
    translation_source: row.translation_source,
    model_provider: row.model_provider,
    model_name: row.model_name,
    status: row.status,
    reviewed_by: row.reviewed_by,
  };
}
