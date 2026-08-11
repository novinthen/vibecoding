import type { Db } from '@/db/client';

import type { ArticleEmbeddingRow, StoryEmbeddingRow } from '../types';

/**
 * Data access for Article/Story embeddings (Stage 7).
 *
 * Embeddings are DERIVED data kept in their own tables — repositories here never
 * touch Article/Story source fields. Each stored vector carries explicit
 * provenance (provider/model/version) and the hash of the exact text embedded.
 * There is exactly one CURRENT embedding per (row, model): re-embedding upserts
 * in place, while historical clustering decisions retain the embedding_version
 * they used, so a later refresh never destroys prior provenance.
 *
 * pgvector's `vector` type is dimensionless in storage, so comparisons must be
 * scoped to a single model (equal dimensions) — every read/NN query below filters
 * by `model`, guaranteeing the compared vectors are dimension-compatible.
 */

export interface UpsertEmbeddingInput {
  provider: string;
  model: string;
  version: number;
  dimensions: number;
  embedding: number[];
  sourceContentHash: string;
}

/** One nearest-neighbour hit: a Story and its representative embedding distance. */
export interface StoryNeighbour {
  story_id: string;
  /** Cosine distance in [0, 2]; similarity = 1 - distance. */
  distance: number;
}

/** Format a numeric vector as a pgvector text literal, e.g. "[0.1,0.2]". */
export function toVectorLiteral(values: number[]): string {
  return `[${values.map((v) => (Number.isFinite(v) ? v : 0)).join(',')}]`;
}

export class ArticleEmbeddingRepository {
  constructor(private readonly db: Db) {}

  async findByArticleAndModel(
    articleId: string,
    model: string,
  ): Promise<ArticleEmbeddingRow | null> {
    const result = await this.db.query<ArticleEmbeddingRow>(
      'SELECT * FROM article_embeddings WHERE article_id = $1 AND model = $2',
      [articleId, model],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Insert or refresh the current embedding for (article, model). Idempotent:
   * re-embedding the same content overwrites the same row rather than piling up
   * versions of a large vector. The version/hash columns record what produced the
   * stored vector; a model/version change is a new distinct row (different model).
   */
  async upsert(
    articleId: string,
    input: UpsertEmbeddingInput,
  ): Promise<ArticleEmbeddingRow> {
    const result = await this.db.query<ArticleEmbeddingRow>(
      `INSERT INTO article_embeddings
         (article_id, provider, model, embedding_version, dimensions,
          embedding, source_content_hash)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7)
       ON CONFLICT (article_id, model) DO UPDATE SET
         provider = EXCLUDED.provider,
         embedding_version = EXCLUDED.embedding_version,
         dimensions = EXCLUDED.dimensions,
         embedding = EXCLUDED.embedding,
         source_content_hash = EXCLUDED.source_content_hash,
         created_at = now()
       RETURNING *`,
      [
        articleId,
        input.provider,
        input.model,
        input.version,
        input.dimensions,
        toVectorLiteral(input.embedding),
        input.sourceContentHash,
      ],
    );
    return result.rows[0] as ArticleEmbeddingRow;
  }
}

export class StoryEmbeddingRepository {
  constructor(private readonly db: Db) {}

  async findByStoryAndModel(
    storyId: string,
    model: string,
  ): Promise<StoryEmbeddingRow | null> {
    const result = await this.db.query<StoryEmbeddingRow>(
      'SELECT * FROM story_embeddings WHERE story_id = $1 AND model = $2',
      [storyId, model],
    );
    return result.rows[0] ?? null;
  }

  async upsert(
    storyId: string,
    input: UpsertEmbeddingInput,
  ): Promise<StoryEmbeddingRow> {
    const result = await this.db.query<StoryEmbeddingRow>(
      `INSERT INTO story_embeddings
         (story_id, provider, model, embedding_version, dimensions,
          embedding, source_content_hash)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7)
       ON CONFLICT (story_id, model) DO UPDATE SET
         provider = EXCLUDED.provider,
         embedding_version = EXCLUDED.embedding_version,
         dimensions = EXCLUDED.dimensions,
         embedding = EXCLUDED.embedding,
         source_content_hash = EXCLUDED.source_content_hash,
         created_at = now()
       RETURNING *`,
      [
        storyId,
        input.provider,
        input.model,
        input.version,
        input.dimensions,
        toVectorLiteral(input.embedding),
        input.sourceContentHash,
      ],
    );
    return result.rows[0] as StoryEmbeddingRow;
  }

  /**
   * Exact nearest-neighbour Stories for a query embedding, scoped to one model
   * (so all vectors share dimensions) and bounded by `limit`. Restricted to a
   * two-sided temporal window `activeSince <= last_activity_at <= activeUntil`,
   * which — together with the limit — keeps candidate generation bounded and
   * prevents a backfilled/older Article from matching an arbitrarily newer Story.
   * Stories with a null `last_activity_at` are excluded (fail conservative).
   * Exact `<=>` (cosine distance) is used deliberately: with a bounded candidate
   * window it is fully deterministic and needs no dimension-fixed ANN index. Only
   * Stories eligible for clustering are returned.
   */
  async nearestStories(params: {
    embedding: number[];
    model: string;
    limit: number;
    activeSince?: Date | string | null;
    activeUntil?: Date | string | null;
    excludeStoryIds?: string[];
  }): Promise<StoryNeighbour[]> {
    const values: unknown[] = [toVectorLiteral(params.embedding), params.model];
    const clauses: string[] = ['se.model = $2'];

    if (params.activeSince) {
      values.push(
        params.activeSince instanceof Date
          ? params.activeSince.toISOString()
          : params.activeSince,
      );
      clauses.push(`s.last_activity_at >= $${values.length}`);
    }
    if (params.activeUntil) {
      values.push(
        params.activeUntil instanceof Date
          ? params.activeUntil.toISOString()
          : params.activeUntil,
      );
      clauses.push(`s.last_activity_at <= $${values.length}`);
    }
    if (params.excludeStoryIds && params.excludeStoryIds.length > 0) {
      values.push(params.excludeStoryIds);
      clauses.push(`se.story_id <> ALL($${values.length}::uuid[])`);
    }
    // Only cluster into Stories that are still open to it.
    clauses.push(`s.status IN ('DRAFT', 'ACTIVE')`);

    values.push(Math.min(Math.max(Math.trunc(params.limit), 1), 200));
    const limitParam = `$${values.length}`;

    const result = await this.db.query<StoryNeighbour>(
      `SELECT se.story_id, (se.embedding <=> $1::vector) AS distance
       FROM story_embeddings se
       JOIN stories s ON s.id = se.story_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY se.embedding <=> $1::vector
       LIMIT ${limitParam}`,
      values,
    );
    return result.rows.map((row) => ({
      story_id: row.story_id,
      distance: Number(row.distance),
    }));
  }
}
