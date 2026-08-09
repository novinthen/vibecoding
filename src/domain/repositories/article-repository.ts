import type { Db } from '@/db/client';

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
