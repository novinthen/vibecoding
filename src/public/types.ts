import type { AuthorityTier, EntityType, SourceType } from '@/domain/enums';

/**
 * Render-facing projections for the public portal.
 *
 * These are deliberately separate from the raw `*Row` types in
 * `@/domain/types`: public pages receive a small, camelCased, join-resolved view
 * (Article + its Source + a source-derived Topic) rather than raw columns, and
 * never see internal fields like url_hash/content_hash/status internals that are
 * irrelevant or must not be exposed publicly.
 */

/** One Article in a public list, with its Source and (source-derived) Topic. */
export interface PublicArticleListItem {
  id: string;
  title: string;
  excerpt: string | null;
  /** Original publisher URL (untrusted; validate before linking). */
  url: string;
  canonicalUrl: string | null;
  publishedAt: string | null;
  discoveredAt: string;
  sourceName: string;
  sourceSlug: string;
  sourceHomepageUrl: string | null;
  authorityTier: AuthorityTier;
  /** Derived from the Article's Source default Topic; may be absent. */
  topicName: string | null;
  topicSlug: string | null;
}

/** Full public Article detail. Adds source-permitted text and provenance. */
export interface PublicArticleDetail extends PublicArticleListItem {
  author: string | null;
  language: string | null;
  /** Source-supplied clean text where available and permitted; may be null. */
  cleanText: string | null;
  sourceUpdatedAt: string | null;
}

export interface PublicTopic {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface PublicTopicWithCount extends PublicTopic {
  articleCount: number;
}

export interface PublicEntity {
  id: string;
  entityType: EntityType;
  name: string;
  slug: string;
  description: string | null;
  homepageUrl: string | null;
  githubUrl: string | null;
}

export interface PublicSource {
  name: string;
  slug: string;
  homepageUrl: string | null;
  authorityTier: AuthorityTier;
  sourceType: SourceType;
  articleCount: number;
}

/**
 * A publicly-renderable Story. `title`/`summary`/`whyItMatters` reflect the
 * publication's editorial projection when published, falling back to canonical
 * fields; they are only ever populated from real records (never fabricated).
 */
export interface PublicStory {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  whyItMatters: string | null;
  topicName: string | null;
  topicSlug: string | null;
  publishedAt: string | null;
  lastActivityAt: string | null;
}

/**
 * A published Story resolved for one Publication, carrying the parent
 * PublicationStory id so the composition layer can attach a locale variant.
 * `publicationStoryId` is an internal join key (a UUID, not a source fact); it
 * is never rendered.
 */
export interface PublishedStory extends PublicStory {
  publicationStoryId: string;
}

/**
 * A PUBLISHED locale variant of a Story, read for public rendering. Fields are
 * the localised editorial text; any null falls back (in the composition layer)
 * to the Publication's canonical publication copy, never to another locale or
 * another Publication.
 */
export interface PublicStoryLocalization {
  locale: string;
  headline: string | null;
  summary: string | null;
  whyItMatters: string | null;
}
