import type { Db } from '@/db/client';

import type { RankingSignals, StoryRankingRow } from '../ranking-types';

export interface CreateStoryRankingInput {
  storyId: string;
  publicationId?: string | null;
  rankingMethod: string;
  rankingVersion: string;
  calculatedScore: number;
  signals: RankingSignals;
  calculatedAt?: Date | string | null;
  timeHorizon?: string | null;
  explanation?: string | null;
}

/**
 * Data access for Story ranking records. Ranking rows are append-only: each
 * ranking calculation creates a new row, preserving history. Rankings may be
 * canonical (publication_id NULL) or publication-specific.
 */
export class StoryRankingRepository {
  constructor(private readonly db: Db) {}

  /**
   * Persist one ranking calculation result. Append-only: never updates an
   * existing row. Returns the created ranking.
   */
  async create(input: CreateStoryRankingInput): Promise<StoryRankingRow> {
    const result = await this.db.query<StoryRankingRowDb>(
      `INSERT INTO story_rankings
         (story_id, publication_id, ranking_method, ranking_version,
          calculated_score, signals, calculated_at, time_horizon, explanation)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, COALESCE($7::timestamptz, now()), $8, $9)
       RETURNING *`,
      [
        input.storyId,
        input.publicationId ?? null,
        input.rankingMethod,
        input.rankingVersion,
        input.calculatedScore,
        JSON.stringify(input.signals),
        toParam(input.calculatedAt),
        input.timeHorizon ?? null,
        input.explanation ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to create story ranking');
    }
    return mapRow(row);
  }

  /**
   * Find the most recent ranking for a Story, optionally scoped to a
   * Publication. Returns null if no ranking exists.
   */
  async findLatestForStory(
    storyId: string,
    publicationId?: string | null,
  ): Promise<StoryRankingRow | null> {
    const result = await this.db.query<StoryRankingRowDb>(
      `SELECT * FROM story_rankings
       WHERE story_id = $1
         AND (($2::uuid IS NULL AND publication_id IS NULL) OR publication_id = $2)
       ORDER BY calculated_at DESC
       LIMIT 1`,
      [storyId, publicationId ?? null],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  /**
   * Find the latest ranking for each Story in the given list, optionally
   * scoped to a Publication. Returns a Map<storyId, ranking>; Stories with
   * no ranking are omitted.
   */
  async findLatestForStories(
    storyIds: string[],
    publicationId?: string | null,
  ): Promise<Map<string, StoryRankingRow>> {
    if (storyIds.length === 0) return new Map();

    const result = await this.db.query<StoryRankingRowDb>(
      `SELECT DISTINCT ON (story_id) *
       FROM story_rankings
       WHERE story_id = ANY($1::uuid[])
         AND (($2::uuid IS NULL AND publication_id IS NULL) OR publication_id = $2)
       ORDER BY story_id, calculated_at DESC`,
      [storyIds, publicationId ?? null],
    );

    const map = new Map<string, StoryRankingRow>();
    for (const row of result.rows) {
      map.set(row.story_id, mapRow(row));
    }
    return map;
  }

  /**
   * List recent ranking calculations across all Stories, most recent first.
   * Optionally scoped to a Publication. Used for admin review and debugging.
   */
  async listRecent(
    limit = 100,
    publicationId?: string | null,
  ): Promise<StoryRankingRow[]> {
    const capped = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const result = await this.db.query<StoryRankingRowDb>(
      `SELECT * FROM story_rankings
       WHERE ($1::uuid IS NULL OR publication_id = $1)
       ORDER BY calculated_at DESC
       LIMIT $2`,
      [publicationId ?? null, capped],
    );
    return result.rows.map(mapRow);
  }

  /**
   * List ranking history for one Story (all versions), most recent first.
   * Optionally scoped to a Publication. Used for admin provenance review.
   */
  async listHistoryForStory(
    storyId: string,
    limit = 50,
    publicationId?: string | null,
  ): Promise<StoryRankingRow[]> {
    const capped = Math.min(Math.max(Math.trunc(limit), 1), 200);
    const result = await this.db.query<StoryRankingRowDb>(
      `SELECT * FROM story_rankings
       WHERE story_id = $1
         AND (($2::uuid IS NULL AND publication_id IS NULL) OR publication_id = $2)
       ORDER BY calculated_at DESC
       LIMIT $3`,
      [storyId, publicationId ?? null, capped],
    );
    return result.rows.map(mapRow);
  }

  /**
   * List the top-ranked Stories for a Publication (or canonical if null),
   * using the most recent ranking for each Story. Returns Story IDs ordered
   * by calculated_score DESC. Used to drive public ranked lists.
   */
  async listTopRankedStoryIds(
    limit = 50,
    publicationId?: string | null,
  ): Promise<string[]> {
    const capped = Math.min(Math.max(Math.trunc(limit), 1), 200);
    // DISTINCT ON gives us the latest ranking per Story, then order by score.
    const result = await this.db.query<{ story_id: string }>(
      `SELECT DISTINCT ON (story_id) story_id
       FROM story_rankings
       WHERE (($1::uuid IS NULL AND publication_id IS NULL) OR publication_id = $1)
       ORDER BY story_id, calculated_at DESC`,
      [publicationId ?? null],
    );

    // Now we have the latest ranking row per Story. We need to order them by score.
    // A more efficient approach: use a window function or subquery. For simplicity:
    const storyIds = result.rows.map((r) => r.story_id);
    if (storyIds.length === 0) return [];

    await this.db.query<{ story_id: string }>(
      `SELECT DISTINCT ON (story_id) story_id
       FROM story_rankings
       WHERE story_id = ANY($1::uuid[])
         AND (($2::uuid IS NULL AND publication_id IS NULL) OR publication_id = $2)
       ORDER BY story_id, calculated_at DESC`,
      [storyIds, publicationId ?? null],
    );

    // Actually, we need to ORDER BY score. Let me rewrite this more carefully:
    const rankedResult = await this.db.query<{
      story_id: string;
      calculated_score: string;
    }>(
      `WITH latest_rankings AS (
         SELECT DISTINCT ON (story_id)
           story_id, calculated_score, calculated_at
         FROM story_rankings
         WHERE (($1::uuid IS NULL AND publication_id IS NULL) OR publication_id = $1)
         ORDER BY story_id, calculated_at DESC
       )
       SELECT story_id
       FROM latest_rankings
       ORDER BY calculated_score DESC
       LIMIT $2`,
      [publicationId ?? null, capped],
    );

    return rankedResult.rows.map((r) => r.story_id);
  }
}

/** Database row with JSONB signals as a string. */
interface StoryRankingRowDb {
  id: string;
  story_id: string;
  publication_id: string | null;
  ranking_method: string;
  ranking_version: string;
  calculated_score: string;
  signals: string;
  calculated_at: string;
  time_horizon: string | null;
  explanation: string | null;
  created_at: string;
}

/** Map database row to domain type (parse JSONB, convert numeric strings). */
function mapRow(row: StoryRankingRowDb): StoryRankingRow {
  return {
    id: row.id,
    story_id: row.story_id,
    publication_id: row.publication_id,
    ranking_method: row.ranking_method,
    ranking_version: row.ranking_version,
    calculated_score: Number(row.calculated_score),
    signals: typeof row.signals === 'string' ? JSON.parse(row.signals) : row.signals,
    calculated_at: row.calculated_at,
    time_horizon: row.time_horizon,
    explanation: row.explanation,
    created_at: row.created_at,
  };
}

function toParam(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : value;
}
