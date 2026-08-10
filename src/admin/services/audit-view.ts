import type { ArticleRow, SourceRow, TopicRow } from '@/domain/types';

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
