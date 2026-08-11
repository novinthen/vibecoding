import type { Db } from '@/db/client';

import type { StoryRankingRow } from '@/domain/ranking-types';
import { StoryRankingRepository } from '@/domain/repositories/story-ranking-repository';

/**
 * Stage 8 — Ranked Story queries for public portal.
 *
 * These methods extend the public content repository to support ranking-based
 * ordering. Stories are ordered by their latest ranking score, with editorial
 * overrides applied per Publication.
 */

/**
 * One published Story with its latest ranking for display/sorting.
 */
export interface PublishedStoryWithRanking {
  // Story fields
  id: string;
  slug: string;
  canonical_title: string;
  summary: string | null;
  why_it_matters: string | null;
  status: string;
  last_activity_at: string | null;
  created_at: string;
  // PublicationStory fields
  publication_story_id: string;
  publication_slug: string | null;
  publication_headline: string | null;
  publication_summary: string | null;
  featured: boolean;
  editorial_priority: number;
  published_at: string | null;
  // Ranking fields (may be null if no ranking exists yet)
  ranking_score: number | null;
  ranking_calculated_at: string | null;
  ranking_method: string | null;
  ranking_version: string | null;
}

/**
 * Get published Stories ordered by ranking score for a Publication.
 * Applies editorial priority and excludes suppressed Stories.
 */
export async function listPublishedStoriesRanked(
  db: Db,
  publicationId: string,
  limit = 50,
  offset = 0,
): Promise<PublishedStoryWithRanking[]> {
  const capped = Math.min(Math.max(Math.trunc(limit), 1), 200);
  const clampedOffset = Math.max(Math.trunc(offset), 0);

  const result = await db.query<
    Omit<PublishedStoryWithRanking, 'ranking_score'> & { ranking_score: string | null }
  >(
    `WITH latest_rankings AS (
       SELECT DISTINCT ON (story_id)
         story_id,
         calculated_score,
         calculated_at,
         ranking_method,
         ranking_version
       FROM story_rankings
       WHERE publication_id = $1 OR (publication_id IS NULL)
       ORDER BY story_id, calculated_at DESC
     )
     SELECT
       s.id,
       s.slug,
       s.canonical_title,
       s.summary,
       s.why_it_matters,
       s.status,
       s.last_activity_at,
       s.created_at,
       ps.id AS publication_story_id,
       ps.slug AS publication_slug,
       ps.headline AS publication_headline,
       ps.published_summary AS publication_summary,
       ps.featured,
       ps.editorial_priority,
       ps.published_at,
       r.calculated_score AS ranking_score,
       r.calculated_at AS ranking_calculated_at,
       r.ranking_method,
       r.ranking_version
     FROM stories s
     JOIN publication_stories ps ON ps.story_id = s.id
     LEFT JOIN latest_rankings r ON r.story_id = s.id
     WHERE ps.publication_id = $1
       AND ps.status = 'PUBLISHED'
       AND ps.suppress_ranking = false
     ORDER BY
       COALESCE(r.calculated_score, 0) + (ps.editorial_priority * 0.1) DESC,
       ps.featured DESC,
       s.last_activity_at DESC NULLS LAST
     LIMIT $2 OFFSET $3`,
    [publicationId, capped, clampedOffset],
  );

  return result.rows.map((row) => ({
    ...row,
    ranking_score: row.ranking_score !== null ? Number(row.ranking_score) : null,
  }));
}

/**
 * Get published Stories for a Topic, ordered by ranking.
 */
export async function listPublishedStoriesForTopicRanked(
  db: Db,
  publicationId: string,
  topicId: string,
  limit = 50,
  offset = 0,
): Promise<PublishedStoryWithRanking[]> {
  const capped = Math.min(Math.max(Math.trunc(limit), 1), 200);
  const clampedOffset = Math.max(Math.trunc(offset), 0);

  const result = await db.query<
    Omit<PublishedStoryWithRanking, 'ranking_score'> & { ranking_score: string | null }
  >(
    `WITH latest_rankings AS (
       SELECT DISTINCT ON (story_id)
         story_id,
         calculated_score,
         calculated_at,
         ranking_method,
         ranking_version
       FROM story_rankings
       WHERE publication_id = $1 OR (publication_id IS NULL)
       ORDER BY story_id, calculated_at DESC
     )
     SELECT
       s.id,
       s.slug,
       s.canonical_title,
       s.summary,
       s.why_it_matters,
       s.status,
       s.last_activity_at,
       s.created_at,
       ps.id AS publication_story_id,
       ps.slug AS publication_slug,
       ps.headline AS publication_headline,
       ps.published_summary AS publication_summary,
       ps.featured,
       ps.editorial_priority,
       ps.published_at,
       r.calculated_score AS ranking_score,
       r.calculated_at AS ranking_calculated_at,
       r.ranking_method,
       r.ranking_version
     FROM stories s
     JOIN publication_stories ps ON ps.story_id = s.id
     LEFT JOIN latest_rankings r ON r.story_id = s.id
     WHERE ps.publication_id = $1
       AND ps.status = 'PUBLISHED'
       AND ps.suppress_ranking = false
       AND s.primary_topic_id = $2
     ORDER BY
       COALESCE(r.calculated_score, 0) + (ps.editorial_priority * 0.1) DESC,
       ps.featured DESC,
       s.last_activity_at DESC NULLS LAST
     LIMIT $3 OFFSET $4`,
    [publicationId, topicId, capped, clampedOffset],
  );

  return result.rows.map((row) => ({
    ...row,
    ranking_score: row.ranking_score !== null ? Number(row.ranking_score) : null,
  }));
}

/**
 * Count published Stories for ranking display (excluding suppressed).
 */
export async function countPublishedStoriesRanked(
  db: Db,
  publicationId: string,
): Promise<number> {
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM publication_stories ps
     WHERE ps.publication_id = $1
       AND ps.status = 'PUBLISHED'
       AND ps.suppress_ranking = false`,
    [publicationId],
  );
  return Number(result.rows[0]?.count ?? 0);
}
