/**
 * Stage 9A — Bounded ranking job.
 *
 * Automated job that processes Stories through the Stage 8 ranking engine.
 * Only ranks valid existing Stories, respects recent rankings (unless forced),
 * and has no publishing side effects.
 *
 * Reuses the Stage 8 ranking engine unchanged.
 */

import type { Pool } from 'pg';

import { RankingEngine } from '@/ranking/ranking-engine';
import { StoryRepository } from '@/domain/repositories/story-repository';

import { buildJobResult } from './job-runner';
import type { ItemFailure, JobOutcome } from './types';

export interface RankingJobOptions {
  /** Maximum number of Stories to process in one run (default: 100). */
  batchLimit?: number;
  /** Force re-ranking even if recent ranking exists. */
  force?: boolean;
  /** Specific Story IDs to process (overrides filters, max 200). */
  storyIds?: string[];
  /** Publication ID for publication-specific ranking (default: canonical). */
  publicationId?: string | null;
}

const JOB_NAME = 'rank';
const DEFAULT_BATCH_LIMIT = 100;
const MAX_EXPLICIT_IDS = 200;

/**
 * Run the bounded ranking job. Processes Stories that need ranking (no recent
 * ranking or force=true), isolating per-Story failures.
 *
 * @param pool - Database pool.
 * @param options - Batch limits and story selection.
 * @returns JobOutcome with per-Story results.
 */
export async function runRankingJob(
  pool: Pool,
  options: RankingJobOptions = {},
): Promise<JobOutcome> {
  const startedAt = new Date();

  const rankingEngine = new RankingEngine(pool);
  const storyRepo = new StoryRepository(pool);

  // Select Stories to process.
  let stories;
  if (options.storyIds && options.storyIds.length > 0) {
    // Explicit story IDs (admin manual trigger or targeted run).
    // Cap to prevent unbounded explicit ID lists.
    const cappedIds = options.storyIds.slice(0, MAX_EXPLICIT_IDS);
    stories = await Promise.all(
      cappedIds.map((id) => storyRepo.findById(id)),
    );
    stories = stories.filter((s) => s !== null);
  } else {
    // Default: find Stories that need ranking.
    stories = await findStoriesNeedingRanking(
      storyRepo,
      options.batchLimit ?? DEFAULT_BATCH_LIMIT,
    );
  }

  const attempted = stories.length;
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  let retryableFailures = 0;
  const failures: ItemFailure[] = [];

  // Process each Story through the Stage 8 ranking engine.
  for (const story of stories) {
    if (!story) continue;

    try {
      const ranking = await rankingEngine.rankStory(
        story.id,
        options.publicationId ?? null,
        options.force ?? false,
      );

      // If rankStory returns without error, it either ranked or reused recent.
      if (ranking) {
        succeeded += 1;
      } else {
        // Should not happen (rankStory throws on error), but handle gracefully.
        skipped += 1;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      failed += 1;
      // Ranking errors are typically non-retryable (missing data, logic errors).
      failures.push({
        itemId: story.id,
        itemType: 'Story',
        error: errorMessage,
        retryable: false,
        context: { storyTitle: story.canonical_title },
      });
    }
  }

  const finishedAt = new Date();
  const errorSummary = buildErrorSummary(failures);
  const metadata = {
    batchLimit: options.batchLimit ?? DEFAULT_BATCH_LIMIT,
    force: options.force ?? false,
    publicationId: options.publicationId ?? null,
    failures: failures.slice(0, 10),
  };

  const result = buildJobResult(
    JOB_NAME,
    startedAt,
    finishedAt,
    { attempted, succeeded, skipped, failed, retryableFailures },
    errorSummary,
    metadata,
  );

  if (result.status === 'SUCCEEDED') {
    return { kind: 'SUCCESS', result };
  }
  if (result.status === 'PARTIAL') {
    return { kind: 'PARTIAL', result, failures };
  }
  return {
    kind: 'FAILED',
    result,
    reason: errorSummary ?? 'All Stories failed ranking.',
  };
}

/**
 * Find Stories that need ranking:
 *  - ACTIVE status (not DRAFT, MERGED, SUPPRESSED, ARCHIVED)
 *  - Has Articles (rankStory will skip Stories with no data)
 *
 * Bounded by batchLimit. Ranking engine will skip Stories with recent rankings.
 */
async function findStoriesNeedingRanking(
  storyRepo: StoryRepository,
  batchLimit: number,
): Promise<Array<NonNullable<Awaited<ReturnType<typeof storyRepo.findById>>>>> {
  // Fetch recent ACTIVE Stories.
  const stories = await storyRepo.listRecent(batchLimit);
  return stories.filter((s) => s !== null && s.status === 'ACTIVE');
}

/**
 * Build a human-readable summary of ranking failures.
 */
function buildErrorSummary(failures: ItemFailure[]): string | null {
  if (failures.length === 0) return null;

  const first3 = failures.slice(0, 3).map((f) => {
    const title = f.context?.storyTitle ?? f.itemId;
    return `${title}: ${f.error}`;
  });

  let summary = `${failures.length} Story/Stories failed ranking. `;
  summary += first3.join('; ');
  if (failures.length > 3) {
    summary += `; and ${failures.length - 3} more.`;
  }

  return summary;
}
