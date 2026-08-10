import type { Db } from '@/db/client';

import { publicArticleStatusSql } from '../article-visibility';
import type { AuthorityTier, EntityType, SourceType } from '../enums';
import type {
  PublicArticleDetail,
  PublicArticleListItem,
  PublicEntity,
  PublicSource,
  PublicStoryLocalization,
  PublicTopicWithCount,
  PublishedStory,
} from '@/public/types';

/**
 * Read-only data access for the public portal.
 *
 * Groups the join-resolved public reads (Articles with their Source and a
 * source-derived Topic, Topic/Source counts, Entities, Story membership) behind
 * one boundary. Every Article query applies the public-visibility rule
 * (`publicArticleStatusSql`) so HIDDEN/DUPLICATE/FAILED Articles never leak to a
 * public surface. All external inputs are bound parameters; the only inlined SQL
 * is the visibility predicate, which is built from a controlled vocabulary, not
 * user input.
 */
export class PublicContentRepository {
  constructor(private readonly db: Db) {}

  // --- Articles ------------------------------------------------------------

  /** List publicly-visible Articles, newest first, with optional filters. */
  async listArticles(
    options: PublicArticleQuery = {},
  ): Promise<PublicArticleListItem[]> {
    const { clauses, params } = this.articleFilters(options);
    const limit = clampLimit(options.limit, 20);
    const offset = clampOffset(options.offset);
    params.push(limit, offset);
    const result = await this.db.query<ArticleListRow>(
      `${ARTICLE_LIST_SELECT}
       WHERE ${clauses.join(' AND ')}
       ORDER BY a.published_at DESC NULLS LAST, a.discovered_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return result.rows.map(mapArticleListItem);
  }

  /** Count publicly-visible Articles matching the same filters (pagination). */
  async countArticles(options: PublicArticleQuery = {}): Promise<number> {
    const { clauses, params } = this.articleFilters(options);
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM articles a
       JOIN sources s ON s.id = a.source_id
       WHERE ${clauses.join(' AND ')}`,
      params,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  /** Fetch one publicly-visible Article by id, or null (also null if not visible). */
  async findArticleById(id: string): Promise<PublicArticleDetail | null> {
    const result = await this.db.query<ArticleDetailRow>(
      `${ARTICLE_DETAIL_SELECT}
       WHERE a.id = $1 AND ${publicArticleStatusSql('a')}`,
      [id],
    );
    const row = result.rows[0];
    return row ? mapArticleDetail(row) : null;
  }

  // --- Search --------------------------------------------------------------

  /**
   * Full-text search over publicly-visible Articles using the generated
   * `search_vector` and `websearch_to_tsquery` (supports quoted phrases and
   * `-exclusion`). Ranked by relevance, then recency.
   */
  async searchArticles(
    query: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<PublicArticleListItem[]> {
    const limit = clampLimit(options.limit, 20);
    const offset = clampOffset(options.offset);
    const result = await this.db.query<ArticleListRow>(
      `${ARTICLE_LIST_SELECT}
       WHERE ${publicArticleStatusSql('a')}
         AND a.search_vector @@ websearch_to_tsquery('english', $1)
       ORDER BY ts_rank(a.search_vector, websearch_to_tsquery('english', $1)) DESC,
                a.published_at DESC NULLS LAST, a.discovered_at DESC
       LIMIT $2 OFFSET $3`,
      [query, limit, offset],
    );
    return result.rows.map(mapArticleListItem);
  }

  /** Count publicly-visible Articles matching a full-text query. */
  async countSearch(query: string): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM articles a
       WHERE ${publicArticleStatusSql('a')}
         AND a.search_vector @@ websearch_to_tsquery('english', $1)`,
      [query],
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  // --- Topics --------------------------------------------------------------

  /**
   * Enabled top-level Topics with a count of publicly-visible Articles reachable
   * through them (an Article's Source default Topic being that Topic or one of
   * its enabled children). Topics with no public Articles are still returned
   * (count 0) so navigation is stable; callers may choose to hide empties.
   */
  async listTopLevelTopicsWithCounts(): Promise<PublicTopicWithCount[]> {
    const result = await this.db.query<TopicCountRow>(
      `SELECT parent.id, parent.name, parent.slug, parent.description,
              COUNT(a.id)::text AS article_count
       FROM topics parent
       LEFT JOIN topics child
         ON child.parent_id = parent.id AND child.enabled = true
       LEFT JOIN sources s
         ON s.default_topic_id = parent.id OR s.default_topic_id = child.id
       LEFT JOIN articles a
         ON a.source_id = s.id AND ${publicArticleStatusSql('a')}
       WHERE parent.parent_id IS NULL AND parent.enabled = true
       GROUP BY parent.id, parent.name, parent.slug, parent.description
       ORDER BY parent.name`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      articleCount: Number(row.article_count),
    }));
  }

  /** The Topic's own id plus its enabled children's ids (for Topic pages). */
  async topicSelfAndChildIds(topicId: string): Promise<string[]> {
    const result = await this.db.query<{ id: string }>(
      `SELECT id FROM topics
       WHERE id = $1 OR (parent_id = $1 AND enabled = true)`,
      [topicId],
    );
    return result.rows.map((r) => r.id);
  }

  // --- Sources -------------------------------------------------------------

  /** Enabled public Sources with their visible-Article counts (Sources page). */
  async listPublicSources(): Promise<PublicSource[]> {
    const result = await this.db.query<SourceCountRow>(
      `SELECT s.name, s.slug, s.homepage_url, s.authority_tier, s.source_type,
              COUNT(a.id)::text AS article_count
       FROM sources s
       LEFT JOIN articles a
         ON a.source_id = s.id AND ${publicArticleStatusSql('a')}
       WHERE s.enabled = true
       GROUP BY s.id, s.name, s.slug, s.homepage_url, s.authority_tier, s.source_type
       ORDER BY s.authority_tier, s.name`,
    );
    return result.rows.map((row) => ({
      name: row.name,
      slug: row.slug,
      homepageUrl: row.homepage_url,
      authorityTier: row.authority_tier,
      sourceType: row.source_type,
      articleCount: Number(row.article_count),
    }));
  }

  // --- Entities (Tools) ----------------------------------------------------

  /** List active Entities (Tool index). Sparse until later enrichment stages. */
  async listEntities(): Promise<PublicEntity[]> {
    const result = await this.db.query<EntityRow>(
      `SELECT id, entity_type, name, slug, description, homepage_url, github_url
       FROM entities
       WHERE status = 'ACTIVE'
       ORDER BY name`,
    );
    return result.rows.map(mapEntity);
  }

  async findEntityBySlug(slug: string): Promise<PublicEntity | null> {
    const result = await this.db.query<EntityRow>(
      `SELECT id, entity_type, name, slug, description, homepage_url, github_url
       FROM entities
       WHERE slug = $1 AND status = 'ACTIVE'`,
      [slug],
    );
    const row = result.rows[0];
    return row ? mapEntity(row) : null;
  }

  /** Publicly-visible Articles linked to an Entity via `article_entities`. */
  async listArticlesForEntity(
    entityId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<PublicArticleListItem[]> {
    const limit = clampLimit(options.limit, 20);
    const offset = clampOffset(options.offset);
    const result = await this.db.query<ArticleListRow>(
      `${ARTICLE_LIST_SELECT}
       JOIN article_entities ae ON ae.article_id = a.id
       WHERE ae.entity_id = $1 AND ${publicArticleStatusSql('a')}
       ORDER BY a.published_at DESC NULLS LAST, a.discovered_at DESC
       LIMIT $2 OFFSET $3`,
      [entityId, limit, offset],
    );
    return result.rows.map(mapArticleListItem);
  }

  // --- Stories (minimal Stage 5 seam) --------------------------------------

  /**
   * Resolve a Story published by a Publication, by the Publication-specific
   * slug. Returns the publication's editorial projection (headline/summary)
   * falling back to canonical Story fields, only for a PublicationStory in
   * PUBLISHED status. The parent PublicationStory id rides along so the caller
   * can attach a locale variant. Returns null when the Publication has no such
   * Story.
   *
   * The result is the Publication's DEFAULT publication copy (the deliberate
   * fallback when no approved localisation exists) — locale overrides are applied
   * by the composition layer, scoped strictly to THIS PublicationStory so
   * localisation content can never leak in from another Publication.
   */
  async findPublishedStory(
    publicationId: string,
    slug: string,
  ): Promise<PublishedStory | null> {
    const result = await this.db.query<StoryRow>(
      `SELECT st.id,
              ps.id AS publication_story_id,
              COALESCE(ps.slug, st.slug) AS slug,
              COALESCE(ps.headline, st.canonical_title) AS title,
              COALESCE(ps.published_summary, st.summary) AS summary,
              COALESCE(ps.published_why_it_matters, st.why_it_matters) AS why_it_matters,
              ps.published_at,
              st.last_activity_at,
              t.name AS topic_name, t.slug AS topic_slug
       FROM publication_stories ps
       JOIN stories st ON st.id = ps.story_id
       LEFT JOIN topics t ON t.id = st.primary_topic_id AND t.enabled = true
       WHERE ps.publication_id = $1 AND ps.slug = $2 AND ps.status = 'PUBLISHED'
       LIMIT 1`,
      [publicationId, slug],
    );
    const row = result.rows[0];
    return row ? mapPublishedStory(row) : null;
  }

  /**
   * The PUBLISHED locale variant of a PublicationStory, or null. Scoped to the
   * parent `publicationStoryId`, so it can only ever return a localisation that
   * belongs to this exact (Publication, Story) attachment — never one from a
   * different Publication. Only PUBLISHED localisations are visible publicly;
   * DRAFT/REVIEW/ARCHIVED variants are not served.
   */
  async findPublishedLocalization(
    publicationStoryId: string,
    locale: string,
  ): Promise<PublicStoryLocalization | null> {
    const result = await this.db.query<LocalizationRow>(
      `SELECT locale, headline, summary, why_it_matters
       FROM story_localizations
       WHERE publication_story_id = $1 AND locale = $2 AND status = 'PUBLISHED'
       LIMIT 1`,
      [publicationStoryId, locale],
    );
    const row = result.rows[0];
    return row ? mapLocalization(row) : null;
  }

  /** Locales with a PUBLISHED localisation for a PublicationStory (for SEO alternates). */
  async listPublishedLocales(publicationStoryId: string): Promise<string[]> {
    const result = await this.db.query<{ locale: string }>(
      `SELECT locale FROM story_localizations
       WHERE publication_story_id = $1 AND status = 'PUBLISHED'
       ORDER BY locale ASC`,
      [publicationStoryId],
    );
    return result.rows.map((r) => r.locale);
  }

  /**
   * PUBLISHED Stories for a Publication (sitemap/feed), most recent first. Only
   * PublicationStories in PUBLISHED status with a slug are returned; canonical
   * facts are read for display only.
   */
  async listPublishedStoriesForPublication(
    publicationId: string,
    options: { limit?: number } = {},
  ): Promise<PublishedStory[]> {
    const limit = clampLimit(options.limit, 50);
    const result = await this.db.query<StoryRow>(
      `SELECT st.id,
              ps.id AS publication_story_id,
              ps.slug AS slug,
              COALESCE(ps.headline, st.canonical_title) AS title,
              COALESCE(ps.published_summary, st.summary) AS summary,
              COALESCE(ps.published_why_it_matters, st.why_it_matters) AS why_it_matters,
              ps.published_at,
              st.last_activity_at,
              t.name AS topic_name, t.slug AS topic_slug
       FROM publication_stories ps
       JOIN stories st ON st.id = ps.story_id
       LEFT JOIN topics t ON t.id = st.primary_topic_id AND t.enabled = true
       WHERE ps.publication_id = $1 AND ps.status = 'PUBLISHED' AND ps.slug IS NOT NULL
       ORDER BY ps.featured DESC, ps.editorial_priority DESC,
                ps.published_at DESC NULLS LAST
       LIMIT $2`,
      [publicationId, limit],
    );
    return result.rows.map(mapPublishedStory);
  }

  /** Publicly-visible Articles that belong to a Story (member reporting). */
  async listArticlesForStory(
    storyId: string,
    options: { limit?: number } = {},
  ): Promise<PublicArticleListItem[]> {
    const limit = clampLimit(options.limit, 50);
    const result = await this.db.query<ArticleListRow>(
      `${ARTICLE_LIST_SELECT}
       JOIN story_articles sa ON sa.article_id = a.id
       WHERE sa.story_id = $1 AND ${publicArticleStatusSql('a')}
       ORDER BY a.published_at DESC NULLS LAST, a.discovered_at DESC
       LIMIT $2`,
      [storyId, limit],
    );
    return result.rows.map(mapArticleListItem);
  }

  // --- internals -----------------------------------------------------------

  /** Build the shared WHERE clauses/params for the Article list & count. */
  private articleFilters(options: PublicArticleQuery): {
    clauses: string[];
    params: unknown[];
  } {
    const clauses: string[] = [publicArticleStatusSql('a')];
    const params: unknown[] = [];
    if (options.topicIds && options.topicIds.length > 0) {
      params.push(options.topicIds);
      clauses.push(`s.default_topic_id = ANY($${params.length}::uuid[])`);
    }
    if (options.sourceSlug) {
      params.push(options.sourceSlug);
      clauses.push(`s.slug = $${params.length}`);
    }
    if (options.authorityTier) {
      params.push(options.authorityTier);
      clauses.push(`s.authority_tier = $${params.length}`);
    }
    return { clauses, params };
  }
}

/** Filters for the public Article list. */
export interface PublicArticleQuery {
  /** Restrict to Articles whose Source default Topic is in this set. */
  topicIds?: readonly string[];
  sourceSlug?: string;
  authorityTier?: AuthorityTier;
  limit?: number;
  offset?: number;
}

// --- shared SELECTs --------------------------------------------------------

const ARTICLE_LIST_SELECT = `
  SELECT a.id, a.original_title, a.original_excerpt, a.url, a.canonical_url,
         a.published_at, a.discovered_at,
         s.name AS source_name, s.slug AS source_slug,
         s.homepage_url AS source_homepage_url, s.authority_tier,
         t.name AS topic_name, t.slug AS topic_slug
  FROM articles a
  JOIN sources s ON s.id = a.source_id
  LEFT JOIN topics t ON t.id = s.default_topic_id AND t.enabled = true`;

const ARTICLE_DETAIL_SELECT = `
  SELECT a.id, a.original_title, a.original_excerpt, a.url, a.canonical_url,
         a.published_at, a.discovered_at, a.author, a.language, a.clean_text,
         a.source_updated_at,
         s.name AS source_name, s.slug AS source_slug,
         s.homepage_url AS source_homepage_url, s.authority_tier,
         t.name AS topic_name, t.slug AS topic_slug
  FROM articles a
  JOIN sources s ON s.id = a.source_id
  LEFT JOIN topics t ON t.id = s.default_topic_id AND t.enabled = true`;

// --- row shapes + mappers --------------------------------------------------

interface ArticleListRow {
  id: string;
  original_title: string;
  original_excerpt: string | null;
  url: string;
  canonical_url: string | null;
  published_at: string | null;
  discovered_at: string;
  source_name: string;
  source_slug: string;
  source_homepage_url: string | null;
  authority_tier: AuthorityTier;
  topic_name: string | null;
  topic_slug: string | null;
}

interface ArticleDetailRow extends ArticleListRow {
  author: string | null;
  language: string | null;
  clean_text: string | null;
  source_updated_at: string | null;
}

interface TopicCountRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  article_count: string;
}

interface SourceCountRow {
  name: string;
  slug: string;
  homepage_url: string | null;
  authority_tier: AuthorityTier;
  source_type: SourceType;
  article_count: string;
}

interface EntityRow {
  id: string;
  entity_type: EntityType;
  name: string;
  slug: string;
  description: string | null;
  homepage_url: string | null;
  github_url: string | null;
}

interface StoryRow {
  id: string;
  publication_story_id: string;
  slug: string;
  title: string;
  summary: string | null;
  why_it_matters: string | null;
  published_at: string | null;
  last_activity_at: string | null;
  topic_name: string | null;
  topic_slug: string | null;
}

interface LocalizationRow {
  locale: string;
  headline: string | null;
  summary: string | null;
  why_it_matters: string | null;
}

function mapArticleListItem(row: ArticleListRow): PublicArticleListItem {
  return {
    id: row.id,
    title: row.original_title,
    excerpt: row.original_excerpt,
    url: row.url,
    canonicalUrl: row.canonical_url,
    publishedAt: row.published_at,
    discoveredAt: row.discovered_at,
    sourceName: row.source_name,
    sourceSlug: row.source_slug,
    sourceHomepageUrl: row.source_homepage_url,
    authorityTier: row.authority_tier,
    topicName: row.topic_name,
    topicSlug: row.topic_slug,
  };
}

function mapArticleDetail(row: ArticleDetailRow): PublicArticleDetail {
  return {
    ...mapArticleListItem(row),
    author: row.author,
    language: row.language,
    cleanText: row.clean_text,
    sourceUpdatedAt: row.source_updated_at,
  };
}

function mapEntity(row: EntityRow): PublicEntity {
  return {
    id: row.id,
    entityType: row.entity_type,
    name: row.name,
    slug: row.slug,
    description: row.description,
    homepageUrl: row.homepage_url,
    githubUrl: row.github_url,
  };
}

function mapPublishedStory(row: StoryRow): PublishedStory {
  return {
    id: row.id,
    publicationStoryId: row.publication_story_id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    whyItMatters: row.why_it_matters,
    topicName: row.topic_name,
    topicSlug: row.topic_slug,
    publishedAt: row.published_at,
    lastActivityAt: row.last_activity_at,
  };
}

function mapLocalization(row: LocalizationRow): PublicStoryLocalization {
  return {
    locale: row.locale,
    headline: row.headline,
    summary: row.summary,
    whyItMatters: row.why_it_matters,
  };
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), 100);
}

function clampOffset(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return 0;
  return Math.trunc(value);
}
