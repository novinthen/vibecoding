import type { Db } from '@/db/client';

import type { ArticleStatus } from '../enums';
import type { ArticleRow } from '../types';

export interface CreateArticleInput {
  sourceId: string;
  url: string;
  originalTitle: string;
  externalId?: string | null;
  canonicalUrl?: string | null;
  urlHash?: string | null;
  originalExcerpt?: string | null;
  author?: string | null;
  publishedAt?: Date | string | null;
  sourceUpdatedAt?: Date | string | null;
  imageUrl?: string | null;
  language?: string | null;
  contentHash?: string | null;
}

/**
 * Data access for canonical Articles.
 *
 * Writes only ever set source-supplied fields; AI-derived data belongs in
 * article_enrichments and is never written here (provenance rule).
 */
export class ArticleRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<ArticleRow | null> {
    const result = await this.db.query<ArticleRow>(
      'SELECT * FROM articles WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  /** Look up an Article by its per-source exact-dedup hash. */
  async findBySourceAndUrlHash(
    sourceId: string,
    urlHash: string,
  ): Promise<ArticleRow | null> {
    const result = await this.db.query<ArticleRow>(
      'SELECT * FROM articles WHERE source_id = $1 AND url_hash = $2',
      [sourceId, urlHash],
    );
    return result.rows[0] ?? null;
  }

  /** Look up an Article by its per-source feed identifier (guid / id). */
  async findBySourceAndExternalId(
    sourceId: string,
    externalId: string,
  ): Promise<ArticleRow | null> {
    const result = await this.db.query<ArticleRow>(
      'SELECT * FROM articles WHERE source_id = $1 AND external_id = $2',
      [sourceId, externalId],
    );
    return result.rows[0] ?? null;
  }

  /** List the most recently published Articles for a Source. */
  async listBySource(sourceId: string, limit = 50): Promise<ArticleRow[]> {
    const result = await this.db.query<ArticleRow>(
      `SELECT * FROM articles
       WHERE source_id = $1
       ORDER BY published_at DESC NULLS LAST
       LIMIT $2`,
      [sourceId, limit],
    );
    return result.rows;
  }

  /**
   * Admin search/filter over Articles. Supports Source, status, and a
   * case-insensitive title/excerpt substring filter, ordered by publication
   * recency, with pagination. The search term is always a bound parameter
   * (never interpolated), so untrusted admin input cannot alter the query.
   */
  async search(filter: ArticleFilter = {}): Promise<ArticleRow[]> {
    const { where, params } = buildArticleWhere(filter);
    const limit = clampLimit(filter.limit, 50);
    const offset =
      filter.offset && filter.offset > 0 ? Math.trunc(filter.offset) : 0;
    params.push(limit, offset);
    const result = await this.db.query<ArticleRow>(
      `SELECT * FROM articles
       ${where}
       ORDER BY published_at DESC NULLS LAST, discovered_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return result.rows;
  }

  /** Most recently ingested Articles across all Sources (overview view). */
  async listRecentlyDiscovered(limit = 10): Promise<ArticleRow[]> {
    const result = await this.db.query<ArticleRow>(
      `SELECT * FROM articles ORDER BY discovered_at DESC LIMIT $1`,
      [clampLimit(limit, 10)],
    );
    return result.rows;
  }

  /** Count Articles matching the same filter (for pagination). */
  async count(filter: ArticleFilter = {}): Promise<number> {
    const { where, params } = buildArticleWhere(filter);
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM articles ${where}`,
      params,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  /**
   * Change an Article's lifecycle status (editorial control). Only the status
   * column is written — source-supplied facts are never touched (provenance
   * rule). Returns the updated row, or null when the id does not exist.
   */
  async updateStatus(
    id: string,
    status: ArticleStatus,
  ): Promise<ArticleRow | null> {
    const result = await this.db.query<ArticleRow>(
      `UPDATE articles SET status = $2 WHERE id = $1 RETURNING *`,
      [id, status],
    );
    return result.rows[0] ?? null;
  }

  async create(input: CreateArticleInput): Promise<ArticleRow> {
    const result = await this.db.query<ArticleRow>(
      `INSERT INTO articles
         (source_id, url, original_title, external_id, canonical_url, url_hash,
          original_excerpt, author, published_at, source_updated_at,
          image_url, language, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      articleValues(input),
    );
    return result.rows[0] as ArticleRow;
  }

  /**
   * Insert an Article, treating a per-Source duplicate (same external_id or
   * url_hash) as a no-op that returns null. Uses `ON CONFLICT DO NOTHING` so no
   * error is raised on a collision — this is what makes repeated or concurrent
   * ingestion idempotent, and, unlike catching a unique-violation, it never
   * aborts a surrounding transaction. The bare (targetless) conflict clause
   * covers BOTH partial unique indexes (external_id and url_hash).
   */
  async createIfAbsent(input: CreateArticleInput): Promise<ArticleRow | null> {
    const result = await this.db.query<ArticleRow>(
      `INSERT INTO articles
         (source_id, url, original_title, external_id, canonical_url, url_hash,
          original_excerpt, author, published_at, source_updated_at,
          image_url, language, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      articleValues(input),
    );
    return result.rows[0] ?? null;
  }
}

/** Filter/pagination options for the admin Article search. */
export interface ArticleFilter {
  sourceId?: string;
  status?: ArticleStatus;
  /** Case-insensitive substring matched against title and excerpt. */
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Build a parameterized WHERE clause from a filter. Every value is a bound
 * parameter; the search term is wrapped for ILIKE with escaped wildcards so an
 * admin cannot inject SQL wildcards that change matching semantics unexpectedly.
 */
function buildArticleWhere(filter: ArticleFilter): {
  where: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.sourceId) {
    params.push(filter.sourceId);
    clauses.push(`source_id = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    clauses.push(`status = $${params.length}`);
  }
  const search = filter.search?.trim();
  if (search) {
    params.push(`%${escapeLike(search)}%`);
    const idx = params.length;
    clauses.push(
      `(original_title ILIKE $${idx} ESCAPE '\\' OR original_excerpt ILIKE $${idx} ESCAPE '\\')`,
    );
  }
  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), 200);
}

/** Positional parameters shared by the create/createIfAbsent inserts. */
function articleValues(input: CreateArticleInput): unknown[] {
  return [
    input.sourceId,
    input.url,
    input.originalTitle,
    input.externalId ?? null,
    input.canonicalUrl ?? null,
    input.urlHash ?? null,
    input.originalExcerpt ?? null,
    input.author ?? null,
    toParam(input.publishedAt),
    toParam(input.sourceUpdatedAt),
    input.imageUrl ?? null,
    input.language ?? null,
    input.contentHash ?? null,
  ];
}

function toParam(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : value;
}
