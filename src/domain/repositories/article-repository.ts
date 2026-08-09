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
  imageUrl?: string | null;
  language?: string | null;
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
          original_excerpt, author, published_at, image_url, language)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        input.sourceId,
        input.url,
        input.originalTitle,
        input.externalId ?? null,
        input.canonicalUrl ?? null,
        input.urlHash ?? null,
        input.originalExcerpt ?? null,
        input.author ?? null,
        input.publishedAt ?? null,
        input.imageUrl ?? null,
        input.language ?? null,
      ],
    );
    return result.rows[0] as ArticleRow;
  }
}
