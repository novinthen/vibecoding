import type { Db } from '@/db/client';

import type { EnrichmentStatus, RelevanceClassification } from '../enums';
import type {
  ArticleEnrichmentRow,
  EnrichmentUsage,
  SuggestedEntity,
  SuggestedTopic,
} from '../types';

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
   * Append one enrichment attempt with the next per-Article version, assigned
   * atomically inside the INSERT (`COALESCE(MAX(version), 0) + 1`). The
   * UNIQUE(article_id, enrichment_version) constraint makes concurrent inserts
   * fail closed rather than silently reuse a version. Returns the stored row.
   */
  async create(input: CreateEnrichmentInput): Promise<ArticleEnrichmentRow> {
    const result = await this.db.query<ArticleEnrichmentRow>(
      `INSERT INTO article_enrichments
         (article_id, enrichment_version, model_provider, model_name,
          prompt_name, prompt_version, schema_version, status,
          relevance, relevance_reason, summary, why_it_matters,
          relevance_score, importance_score, technical_depth, novelty_score,
          confidence, suggested_topics, suggested_entities, usage,
          structured_output, validation_error, error_code, error_message,
          generated_at)
       SELECT
          $1,
          COALESCE(
            (SELECT MAX(enrichment_version) FROM article_enrichments
             WHERE article_id = $1), 0) + 1,
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
