import type { Db } from '@/db/client';

import type { ClusteringDecision, ClusteringSource } from '../enums';
import type {
  ClusteringCandidateRecord,
  ClusteringDecisionRow,
} from '../types';

/**
 * One clustering attempt to record. Every field is DERIVED provenance — this
 * input never carries or touches an Article source fact. The row is an
 * append-only audit of what the clustering engine (or an editor) decided and
 * why, including the full scored candidate set for later review.
 */
export interface RecordDecisionInput {
  articleId: string;
  storyId?: string | null;
  method: string;
  methodVersion: string;
  embeddingProvider?: string | null;
  embeddingModel?: string | null;
  embeddingVersion?: number | null;
  decision: ClusteringDecision;
  decisionSource?: ClusteringSource;
  topScore?: number | null;
  confidence?: number | null;
  candidateCount?: number;
  reason?: string | null;
  candidates?: ClusteringCandidateRecord[];
  signals?: Record<string, number | null> | null;
}

/**
 * Data access for the ClusteringDecision log (Stage 7).
 *
 * Append-only: each clustering attempt writes exactly one row and prior rows are
 * never mutated, so the decision history for an Article/Story is fully auditable
 * and re-runs are explainable. This repository only ever writes to
 * `clustering_decisions`; it never modifies an Article, Story, or membership.
 */
export class ClusteringDecisionRepository {
  constructor(private readonly db: Db) {}

  async record(input: RecordDecisionInput): Promise<ClusteringDecisionRow> {
    const result = await this.db.query<ClusteringDecisionRow>(
      `INSERT INTO clustering_decisions
         (article_id, story_id, method, method_version, embedding_provider,
          embedding_model, embedding_version, decision, decision_source,
          top_score, confidence, candidate_count, reason, candidates, signals)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               $14::jsonb, $15::jsonb)
       RETURNING *`,
      [
        input.articleId,
        input.storyId ?? null,
        input.method,
        input.methodVersion,
        input.embeddingProvider ?? null,
        input.embeddingModel ?? null,
        input.embeddingVersion ?? null,
        input.decision,
        input.decisionSource ?? 'AUTOMATIC',
        input.topScore ?? null,
        input.confidence ?? null,
        input.candidateCount ?? input.candidates?.length ?? 0,
        input.reason ?? null,
        JSON.stringify(input.candidates ?? []),
        input.signals ? JSON.stringify(input.signals) : null,
      ],
    );
    return result.rows[0] as ClusteringDecisionRow;
  }

  /** Clustering attempts for an Article, newest first. */
  async listByArticle(
    articleId: string,
    limit = 20,
  ): Promise<ClusteringDecisionRow[]> {
    const result = await this.db.query<ClusteringDecisionRow>(
      `SELECT * FROM clustering_decisions
       WHERE article_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [articleId, clampLimit(limit)],
    );
    return result.rows;
  }

  /** Clustering attempts that chose a given Story, newest first. */
  async listByStory(
    storyId: string,
    limit = 50,
  ): Promise<ClusteringDecisionRow[]> {
    const result = await this.db.query<ClusteringDecisionRow>(
      `SELECT * FROM clustering_decisions
       WHERE story_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [storyId, clampLimit(limit)],
    );
    return result.rows;
  }
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(Math.max(Math.trunc(value), 1), 200);
}
