import type { Db } from '@/db/client';
import { StoryEmbeddingRepository } from '@/domain';
import type { ArticleRow } from '@/domain/types';

import type { CandidateFeatures } from './scoring';
import { tokenSet } from './tokens';

/**
 * Candidate generation for Story clustering (Stage 7).
 *
 * We deliberately do NOT compare an Article against every other Article/Story.
 * Instead we generate a small, bounded, EXPLAINABLE candidate set from a few
 * deterministic signals, each capped by a limit and a publication-time window:
 *
 *   1. embedding nearest-neighbours  — semantically closest Stories;
 *   2. shared canonical Entities     — Stories linked to the same Entity.
 *
 * The union (deduplicated, capped) is scored downstream. Every candidate records
 * which signal(s) surfaced it (`sources`), so a reviewer can see why it was even
 * considered. All queries are scoped to a single embedding model (so vectors are
 * dimension-compatible) and to clustering-eligible Stories (DRAFT/ACTIVE).
 */

export interface CandidateOptions {
  /** How far back a Story's activity may be to still be a candidate. */
  timeWindowHours?: number;
  /** Max embedding nearest-neighbour candidates. */
  maxEmbeddingCandidates?: number;
  /** Max shared-entity candidates. */
  maxEntityCandidates?: number;
  /** Hard cap on the total candidate set that gets scored. */
  maxCandidates?: number;
}

export const DEFAULT_CANDIDATE_OPTIONS: Required<CandidateOptions> = {
  // Two weeks: same-event coverage clusters within days, not months.
  timeWindowHours: 24 * 14,
  maxEmbeddingCandidates: 20,
  maxEntityCandidates: 20,
  maxCandidates: 25,
};

export interface GenerateCandidatesParams {
  db: Db;
  article: ArticleRow;
  /** The Article's embedding vector (already computed/persisted). */
  embedding: number[];
  /** Embedding model the vector belongs to (scopes all comparisons). */
  model: string;
  /** The Article's canonical Entity ids (for the shared-entity signal). */
  articleEntityIds: Set<string>;
  /** Stories the Article already belongs to — never re-proposed as candidates. */
  excludeStoryIds: string[];
  options?: CandidateOptions;
}

/** Parse a pgvector text literal ("[0.1,0.2]") into a number[]. */
export function parseVector(literal: string): number[] {
  try {
    const parsed = JSON.parse(literal) as unknown;
    return Array.isArray(parsed) ? (parsed as number[]) : [];
  } catch {
    return [];
  }
}

function referenceDate(article: ArticleRow): Date {
  const raw = article.published_at ?? article.discovered_at;
  const date = raw ? new Date(raw) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/**
 * Generate the bounded candidate Story set for an Article. Returns fully-loaded
 * {@link CandidateFeatures} ready to score. The set is capped at
 * `maxCandidates`; embedding neighbours are preferred over entity-only matches
 * when trimming, since embeddings are the stronger same-event signal.
 */
export async function generateCandidates(
  params: GenerateCandidatesParams,
): Promise<CandidateFeatures[]> {
  const options = { ...DEFAULT_CANDIDATE_OPTIONS, ...params.options };
  const { db, article, embedding, model, articleEntityIds } = params;
  const activeSince = new Date(
    referenceDate(article).getTime() - options.timeWindowHours * 3600 * 1000,
  );

  // Track which signal(s) surfaced each candidate Story, preserving discovery
  // order (embedding neighbours first) for deterministic trimming.
  const sourcesByStory = new Map<string, Set<string>>();
  const order: string[] = [];
  const note = (storyId: string, source: string): void => {
    let set = sourcesByStory.get(storyId);
    if (!set) {
      set = new Set();
      sourcesByStory.set(storyId, set);
      order.push(storyId);
    }
    set.add(source);
  };

  // 1. Embedding nearest-neighbours.
  const neighbours = await new StoryEmbeddingRepository(db).nearestStories({
    embedding,
    model,
    limit: options.maxEmbeddingCandidates,
    activeSince,
    excludeStoryIds: params.excludeStoryIds,
  });
  for (const neighbour of neighbours) note(neighbour.story_id, 'embedding');

  // 2. Shared canonical Entities (only when the Article has any).
  if (articleEntityIds.size > 0) {
    const entityStories = await sharedEntityStories(
      db,
      [...articleEntityIds],
      activeSince,
      params.excludeStoryIds,
      options.maxEntityCandidates,
    );
    for (const storyId of entityStories) note(storyId, 'entity');
  }

  const candidateIds = order.slice(0, options.maxCandidates);
  if (candidateIds.length === 0) return [];

  return loadCandidateFeatures(db, candidateIds, model, sourcesByStory);
}

/** Stories linked to any of the given Entities, within the window and eligible. */
async function sharedEntityStories(
  db: Db,
  entityIds: string[],
  activeSince: Date,
  excludeStoryIds: string[],
  limit: number,
): Promise<string[]> {
  const result = await db.query<{ story_id: string }>(
    `SELECT DISTINCT se.story_id
     FROM story_entities se
     JOIN stories s ON s.id = se.story_id
     WHERE se.entity_id = ANY($1::uuid[])
       AND s.status IN ('DRAFT', 'ACTIVE')
       AND (s.last_activity_at IS NULL OR s.last_activity_at >= $2)
       AND se.story_id <> ALL($3::uuid[])
     LIMIT $4`,
    [entityIds, activeSince.toISOString(), excludeStoryIds, clamp(limit)],
  );
  return result.rows.map((row) => row.story_id);
}

/**
 * Load the scoring features for a set of candidate Stories in a bounded number of
 * batch queries (no per-Story N+1). Each Story is anchored on its representative
 * Article (explicit primary, else earliest attached).
 */
async function loadCandidateFeatures(
  db: Db,
  storyIds: string[],
  model: string,
  sourcesByStory: Map<string, Set<string>>,
): Promise<CandidateFeatures[]> {
  // Representative Article per Story.
  const reps = await db.query<{ story_id: string; article_id: string }>(
    `SELECT DISTINCT ON (sa.story_id) sa.story_id, sa.article_id
     FROM story_articles sa
     JOIN stories s ON s.id = sa.story_id
     WHERE sa.story_id = ANY($1::uuid[])
     ORDER BY sa.story_id,
       (sa.article_id = s.primary_article_id) DESC,
       (sa.relationship_type = 'PRIMARY') DESC,
       sa.created_at ASC`,
    [storyIds],
  );
  const repByStory = new Map(reps.rows.map((r) => [r.story_id, r.article_id]));
  const repIds = [...repByStory.values()];

  const stories = await db.query<{
    id: string;
    last_activity_at: string | null;
  }>(`SELECT id, last_activity_at FROM stories WHERE id = ANY($1::uuid[])`, [
    storyIds,
  ]);
  const lastActivityByStory = new Map(
    stories.rows.map((s) => [s.id, s.last_activity_at]),
  );

  if (repIds.length === 0) return [];

  const titlesResult = await db.query<{
    id: string;
    normalized_title: string | null;
    original_title: string;
  }>(
    `SELECT id, normalized_title, original_title
     FROM articles WHERE id = ANY($1::uuid[])`,
    [repIds],
  );
  const titleByArticle = new Map(
    titlesResult.rows.map((r) => [
      r.id,
      tokenSet(r.normalized_title || r.original_title || ''),
    ]),
  );

  const embeddingsResult = await db.query<{
    article_id: string;
    embedding: string;
  }>(
    `SELECT article_id, embedding FROM article_embeddings
     WHERE article_id = ANY($1::uuid[]) AND model = $2`,
    [repIds, model],
  );
  const embeddingByArticle = new Map(
    embeddingsResult.rows.map((r) => [r.article_id, parseVector(r.embedding)]),
  );

  const entitiesResult = await db.query<{
    article_id: string;
    entity_id: string;
  }>(
    `SELECT article_id, entity_id FROM article_entities
     WHERE article_id = ANY($1::uuid[])`,
    [repIds],
  );
  const entitiesByArticle = new Map<string, Set<string>>();
  for (const row of entitiesResult.rows) {
    let set = entitiesByArticle.get(row.article_id);
    if (!set) {
      set = new Set();
      entitiesByArticle.set(row.article_id, set);
    }
    set.add(row.entity_id);
  }

  const candidates: CandidateFeatures[] = [];
  for (const storyId of storyIds) {
    const repId = repByStory.get(storyId) ?? null;
    // A Story with no representative embedding cannot be compared meaningfully;
    // skip it rather than scoring against an empty vector (which would be 0).
    const repEmbedding = repId ? embeddingByArticle.get(repId) : undefined;
    if (!repId || !repEmbedding || repEmbedding.length === 0) continue;

    const lastActivity = lastActivityByStory.get(storyId) ?? null;
    candidates.push({
      storyId,
      representativeArticleId: repId,
      embedding: repEmbedding,
      titleTokens: titleByArticle.get(repId) ?? new Set(),
      entityIds: entitiesByArticle.get(repId) ?? new Set(),
      lastActivityAt: lastActivity ? new Date(lastActivity) : null,
      sources: [...(sourcesByStory.get(storyId) ?? [])],
    });
  }
  return candidates;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(Math.max(Math.trunc(value), 1), 200);
}
