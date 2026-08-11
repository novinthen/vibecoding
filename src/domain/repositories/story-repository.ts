import type { Db } from '@/db/client';

import type {
  ClusteringSource,
  StoryArticleRelationship,
  StoryReviewState,
} from '../enums';
import type { StoryArticleRow, StoryRow } from '../types';

export interface CreateStoryInput {
  slug: string;
  canonicalTitle: string;
  primaryTopicId?: string | null;
}

/** Full input for a clustering-formed Story (automatic or manual). */
export interface CreateClusteredStoryInput {
  slug: string;
  canonicalTitle: string;
  primaryTopicId?: string | null;
  primaryArticleId?: string | null;
  formationSource?: ClusteringSource;
  clusteringMethod?: string | null;
  clusteringVersion?: string | null;
  /** Initial activity timestamp (defaults to now() when omitted). */
  lastActivityAt?: Date | string | null;
}

/** Provenance recorded on a Story <-> Article attachment. */
export interface AttachArticleInput {
  relationshipType?: StoryArticleRelationship;
  confidence?: number | null;
  assignmentSource?: string | null;
  clusteringMethod?: string | null;
  clusteringVersion?: string | null;
  score?: number | null;
  decisionReason?: string | null;
  signals?: Record<string, unknown> | null;
}

/** One recent Story with aggregate stats for the admin clustering list. */
export interface StoryWithStats extends StoryRow {
  article_count: number;
  /** Distinct Source count across attached Articles (source diversity). */
  source_count: number;
}

/**
 * Data access for Stories and Story<->Article membership.
 *
 * A Story is distinct from an Article; membership is expressed through the
 * story_articles join, never by folding one concept into the other. Stage 7 adds
 * clustering provenance/review helpers here, but the repository still NEVER
 * writes an Article source fact.
 */
export class StoryRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<StoryRow | null> {
    const result = await this.db.query<StoryRow>(
      'SELECT * FROM stories WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findBySlug(slug: string): Promise<StoryRow | null> {
    const result = await this.db.query<StoryRow>(
      'SELECT * FROM stories WHERE slug = $1',
      [slug],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Recent Stories (admin view), most recently active first. Used when attaching
   * a canonical Story to a Publication — the editor picks a real Story, so no
   * fake Story is ever invented to demonstrate publishing.
   */
  async listRecent(limit = 100): Promise<StoryRow[]> {
    const capped = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const result = await this.db.query<StoryRow>(
      `SELECT * FROM stories
       ORDER BY last_activity_at DESC NULLS LAST, created_at DESC
       LIMIT $1`,
      [capped],
    );
    return result.rows;
  }

  /** Recent Stories with member/source-diversity counts for the clustering view. */
  async listRecentWithStats(limit = 100): Promise<StoryWithStats[]> {
    const capped = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const result = await this.db.query<
      StoryRow & { article_count: string; source_count: string }
    >(
      `SELECT s.*,
              COUNT(sa.article_id)::text AS article_count,
              COUNT(DISTINCT a.source_id)::text AS source_count
       FROM stories s
       LEFT JOIN story_articles sa ON sa.story_id = s.id
       LEFT JOIN articles a ON a.id = sa.article_id
       GROUP BY s.id
       ORDER BY s.last_activity_at DESC NULLS LAST, s.created_at DESC
       LIMIT $1`,
      [capped],
    );
    return result.rows.map((row) => ({
      ...row,
      article_count: Number(row.article_count),
      source_count: Number(row.source_count),
    }));
  }

  async create(input: CreateStoryInput): Promise<StoryRow> {
    const result = await this.db.query<StoryRow>(
      `INSERT INTO stories (slug, canonical_title, primary_topic_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.slug, input.canonicalTitle, input.primaryTopicId ?? null],
    );
    return result.rows[0] as StoryRow;
  }

  /**
   * Create a Story formed by clustering (automatic) or by an editor (manual).
   * A newly formed Story starts DRAFT and UNREVIEWED (an internal/reviewable
   * state): clustering NEVER publishes — publishing remains the explicit
   * PublicationStory boundary. `canonical_title` is a PROVISIONAL, evidence-based
   * value seeded from the primary Article and is safe to change on review; the
   * clustering_decisions log records which Article seeded it.
   */
  async createClustered(input: CreateClusteredStoryInput): Promise<StoryRow> {
    const result = await this.db.query<StoryRow>(
      `INSERT INTO stories
         (slug, canonical_title, primary_topic_id, primary_article_id,
          formation_source, clustering_method, clustering_version,
          last_activity_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()))
       RETURNING *`,
      [
        input.slug,
        input.canonicalTitle,
        input.primaryTopicId ?? null,
        input.primaryArticleId ?? null,
        input.formationSource ?? 'AUTOMATIC',
        input.clusteringMethod ?? null,
        input.clusteringVersion ?? null,
        toParam(input.lastActivityAt),
      ],
    );
    return result.rows[0] as StoryRow;
  }

  /**
   * Link an Article to a Story. Idempotent on the (story, article) primary key:
   * an existing link is left unchanged rather than duplicated.
   */
  async addArticle(
    storyId: string,
    articleId: string,
    relationshipType: StoryArticleRelationship = 'RELATED',
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO story_articles (story_id, article_id, relationship_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (story_id, article_id) DO NOTHING`,
      [storyId, articleId, relationshipType],
    );
  }

  /**
   * Attach an Article with full clustering provenance. Idempotent: a duplicate
   * (story, article) is a no-op (the same Article is never linked to the same
   * Story twice). Returns true iff a new row was inserted.
   */
  async attachArticle(
    storyId: string,
    articleId: string,
    input: AttachArticleInput = {},
  ): Promise<boolean> {
    const result = await this.db.query(
      `INSERT INTO story_articles
         (story_id, article_id, relationship_type, confidence,
          assignment_source, clustering_method, clustering_version,
          score, decision_reason, signals)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       ON CONFLICT (story_id, article_id) DO NOTHING`,
      [
        storyId,
        articleId,
        input.relationshipType ?? 'RELATED',
        input.confidence ?? null,
        input.assignmentSource ?? null,
        input.clusteringMethod ?? null,
        input.clusteringVersion ?? null,
        input.score ?? null,
        input.decisionReason ?? null,
        input.signals ? JSON.stringify(input.signals) : null,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Remove an Article from a Story. Returns true iff a row was removed. */
  async detachArticle(storyId: string, articleId: string): Promise<boolean> {
    const result = await this.db.query(
      'DELETE FROM story_articles WHERE story_id = $1 AND article_id = $2',
      [storyId, articleId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Return the Articles belonging to a Story. */
  async listArticleIds(storyId: string): Promise<string[]> {
    const result = await this.db.query<{ article_id: string }>(
      'SELECT article_id FROM story_articles WHERE story_id = $1',
      [storyId],
    );
    return result.rows.map((row) => row.article_id);
  }

  /** Full membership rows (with provenance) for a Story, newest first. */
  async listMemberships(storyId: string): Promise<StoryArticleRow[]> {
    const result = await this.db.query<StoryArticleRow>(
      `SELECT * FROM story_articles
       WHERE story_id = $1
       ORDER BY created_at ASC`,
      [storyId],
    );
    return result.rows;
  }

  /** All Story memberships an Article currently has (usually zero or one). */
  async listStoryIdsForArticle(articleId: string): Promise<string[]> {
    const result = await this.db.query<{ story_id: string }>(
      'SELECT story_id FROM story_articles WHERE article_id = $1',
      [articleId],
    );
    return result.rows.map((row) => row.story_id);
  }

  /**
   * The Story's representative Article — the explicit primary, else the earliest
   * attached Article. Used as the comparison anchor when scoring candidates.
   */
  async representativeArticleId(storyId: string): Promise<string | null> {
    const result = await this.db.query<{ article_id: string }>(
      `SELECT sa.article_id
       FROM story_articles sa
       JOIN stories s ON s.id = sa.story_id
       WHERE sa.story_id = $1
       ORDER BY (sa.article_id = s.primary_article_id) DESC,
                (sa.relationship_type = 'PRIMARY') DESC,
                sa.created_at ASC
       LIMIT 1`,
      [storyId],
    );
    return result.rows[0]?.article_id ?? null;
  }

  /** Update a Story's clustering review state (editorial protection control). */
  async updateReviewState(
    storyId: string,
    reviewState: StoryReviewState,
  ): Promise<StoryRow | null> {
    const result = await this.db.query<StoryRow>(
      'UPDATE stories SET review_state = $2 WHERE id = $1 RETURNING *',
      [storyId, reviewState],
    );
    return result.rows[0] ?? null;
  }

  /** Advance a Story's last-activity timestamp (never moves it backwards). */
  async touchActivity(
    storyId: string,
    at: Date | string | null = null,
  ): Promise<void> {
    await this.db.query(
      `UPDATE stories
       SET last_activity_at = GREATEST(
         COALESCE(last_activity_at, to_timestamp(0)),
         COALESCE($2::timestamptz, now()))
       WHERE id = $1`,
      [storyId, toParam(at)],
    );
  }

  /** Clear the primary-article pointer when that Article is detached. */
  async clearPrimaryArticleIfMatches(
    storyId: string,
    articleId: string,
  ): Promise<void> {
    await this.db.query(
      `UPDATE stories SET primary_article_id = NULL
       WHERE id = $1 AND primary_article_id = $2`,
      [storyId, articleId],
    );
  }
}

function toParam(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : value;
}
