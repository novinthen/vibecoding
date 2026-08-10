import type { Pool } from 'pg';

import { getPool, withTransaction, type Db } from '@/db/client';

import type { EnrichmentStatus, RelevanceClassification } from '../enums';
import type {
  ArticleEnrichmentRow,
  EnrichmentUsage,
  SuggestedEntity,
  SuggestedTopic,
} from '../types';

/**
 * Fixed namespace for the per-Article enrichment-version advisory lock. Combined
 * with `hashtext(article_id)` it forms a two-int `pg_advisory_xact_lock` key, so
 * enrichment-version allocation for one Article serialises while different
 * Articles (different hashes) do not block each other. Exported so tests can take
 * the identical lock.
 */
export const ENRICHMENT_LOCK_NAMESPACE = 6647410; // 0x656E72 — "enr"

/**
 * Fields persisted for one AI enrichment attempt. Every field is derived data —
 * this input NEVER carries or touches an Article source fact. `enrichmentVersion`
 * is not accepted here: the repository assigns the next per-Article version
 * atomically so callers cannot clobber prior provenance.
 */
export interface CreateEnrichmentInput {
  articleId: string;
  modelProvider: string;
  modelName: string;
  promptName?: string | null;
  promptVersion?: string | null;
  schemaVersion?: string | null;
  status: EnrichmentStatus;
  relevance?: RelevanceClassification | null;
  relevanceReason?: string | null;
  summary?: string | null;
  whyItMatters?: string | null;
  relevanceScore?: number | null;
  importanceScore?: number | null;
  technicalDepth?: number | null;
  noveltyScore?: number | null;
  confidence?: number | null;
  suggestedTopics?: SuggestedTopic[];
  suggestedEntities?: SuggestedEntity[];
  usage?: EnrichmentUsage | null;
  structuredOutput?: Record<string, unknown> | null;
  validationError?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  generatedAt?: Date | string | null;
}

/** Options controlling the owned persistence transaction. */
export interface PersistEnrichmentOptions {
  /** Pool to open the transaction on (defaults to the shared pool). */
  pool?: Pool;
  /**
   * Extra work to run INSIDE the same transaction as the enrichment insert (e.g.
   * the admin audit write), so persistence and its audit commit atomically. It
   * must not perform any network I/O — the transaction is meant to stay short.
   */
  withinTx?: (tx: Db, enrichment: ArticleEnrichmentRow) => Promise<void>;
}

/**
 * Data access for versioned AI ArticleEnrichments (Stage 6).
 *
 * This repository only ever writes to `article_enrichments`; it never updates an
 * Article, Story, Entity, Topic, or any canonical relationship. Each write is an
 * append that receives a fresh per-Article version, so re-running enrichment
 * accumulates history instead of destroying it (provenance rule). Reads expose
 * the latest version and the full version history for admin review.
 */
export class ArticleEnrichmentRepository {
  constructor(private readonly db: Db) {}

  /**
   * Append one enrichment attempt with the next per-Article version, atomically
   * and concurrency-safely — the transaction is owned HERE, not by the caller, so
   * correctness never depends on a caller remembering to wrap this in one.
   *
   * The method opens its own short transaction and, inside it: (1) takes a
   * transaction-scoped advisory lock keyed on the Article in its own statement;
   * (2) reads `MAX(version) + 1` and inserts. The ordering matters under READ
   * COMMITTED — the INSERT's snapshot is taken after the lock is granted, i.e.
   * after any predecessor holding the same key has committed, so each concurrent
   * write for the same Article reads a fresh MAX and gets its own distinct,
   * contiguous version instead of colliding on the UNIQUE constraint and losing an
   * attempt. (Folding the lock into the INSERT's own statement would not work: its
   * snapshot predates the lock, so a blocked writer would still read a stale MAX.
   * Splitting the two statements across autocommit connections would also fail:
   * the lock would release before the INSERT — hence the owned transaction here.)
   * Different Articles hash to different keys and never serialise. The lock
   * releases at transaction end; UNIQUE(article_id, enrichment_version) backstops.
   *
   * The external AI provider call must have completed BEFORE this is invoked —
   * this transaction is deliberately short and holds no network operation.
   *
   * `options.withinTx` runs additional work (e.g. the admin audit write) INSIDE
   * the same transaction, so persistence and its audit commit atomically.
   */
  async createVersioned(
    input: CreateEnrichmentInput,
    options: PersistEnrichmentOptions = {},
  ): Promise<ArticleEnrichmentRow> {
    const pool = options.pool ?? getPool();
    return withTransaction(async (tx) => {
      // Statement 1: acquire the per-Article allocation lock (txn-scoped).
      await tx.query('SELECT pg_advisory_xact_lock($1, hashtext($2::text))', [
        ENRICHMENT_LOCK_NAMESPACE,
        input.articleId,
      ]);
      // Statement 2: allocate MAX+1 and insert, under a snapshot taken after the
      // lock was granted (so a just-committed predecessor's version is visible).
      const enrichment = await this.insertVersion(tx, input);
      if (options.withinTx) await options.withinTx(tx, enrichment);
      return enrichment;
    }, pool);
  }

  /** The INSERT itself, assuming the allocation lock is already held in `tx`. */
  private async insertVersion(
    tx: Db,
    input: CreateEnrichmentInput,
  ): Promise<ArticleEnrichmentRow> {
    const result = await tx.query<ArticleEnrichmentRow>(
      `INSERT INTO article_enrichments
         (article_id, enrichment_version, model_provider, model_name,
          prompt_name, prompt_version, schema_version, status,
          relevance, relevance_reason, summary, why_it_matters,
          relevance_score, importance_score, technical_depth, novelty_score,
          confidence, suggested_topics, suggested_entities, usage,
          structured_output, validation_error, error_code, error_message,
          generated_at)
       SELECT
          $1::uuid,
          COALESCE(
            (SELECT MAX(enrichment_version) FROM article_enrichments
             WHERE article_id = $1::uuid), 0) + 1,
          $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17::jsonb, $18::jsonb, $19::jsonb, $20::jsonb, $21, $22, $23,
          COALESCE($24::timestamptz, now())
       RETURNING *`,
      [
        input.articleId,
        input.modelProvider,
        input.modelName,
        input.promptName ?? null,
        input.promptVersion ?? null,
        input.schemaVersion ?? null,
        input.status,
        input.relevance ?? null,
        input.relevanceReason ?? null,
        input.summary ?? null,
        input.whyItMatters ?? null,
        input.relevanceScore ?? null,
        input.importanceScore ?? null,
        input.technicalDepth ?? null,
        input.noveltyScore ?? null,
        input.confidence ?? null,
        JSON.stringify(input.suggestedTopics ?? []),
        JSON.stringify(input.suggestedEntities ?? []),
        input.usage ? JSON.stringify(input.usage) : null,
        input.structuredOutput ? JSON.stringify(input.structuredOutput) : null,
        input.validationError ?? null,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        toParam(input.generatedAt),
      ],
    );
    return result.rows[0] as ArticleEnrichmentRow;
  }

  /** The most recent enrichment attempt (highest version) for an Article. */
  async findLatest(articleId: string): Promise<ArticleEnrichmentRow | null> {
    const result = await this.db.query<ArticleEnrichmentRow>(
      `SELECT * FROM article_enrichments
       WHERE article_id = $1
       ORDER BY enrichment_version DESC
       LIMIT 1`,
      [articleId],
    );
    return result.rows[0] ?? null;
  }

  /** Full version history for an Article, newest first (for admin review). */
  async listByArticle(
    articleId: string,
    limit = 20,
  ): Promise<ArticleEnrichmentRow[]> {
    const result = await this.db.query<ArticleEnrichmentRow>(
      `SELECT * FROM article_enrichments
       WHERE article_id = $1
       ORDER BY enrichment_version DESC
       LIMIT $2`,
      [articleId, clampLimit(limit)],
    );
    return result.rows;
  }

  async findById(id: string): Promise<ArticleEnrichmentRow | null> {
    const result = await this.db.query<ArticleEnrichmentRow>(
      'SELECT * FROM article_enrichments WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(Math.max(Math.trunc(value), 1), 100);
}

function toParam(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : value;
}
