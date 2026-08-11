/**
 * Stage 9A — Bounded clustering job.
 *
 * Automated job that processes Articles through the Stage 7 clustering engine.
 * Eligibility is conservative (Articles not yet clustered or with outdated
 * clustering), batch-limited, and per-Article failures are isolated.
 *
 * Reuses the Stage 7 clustering engine unchanged. Respects REVIEWED/LOCKED
 * Story protection (never auto-modifies protected Stories).
 */

import type { Pool } from 'pg';

import { clusterArticle, isEligibleForClustering } from '@/clustering';
import { resolveEmbeddingProvider } from '@/clustering/embedding/config';
import { ArticleRepository } from '@/domain/repositories/article-repository';
import { ClusteringDecisionRepository } from '@/domain/repositories/clustering-decision-repository';

import { buildJobResult } from './job-runner';
import type { ItemFailure, JobOutcome } from './types';

export interface ClusteringJobOptions {
  /** Maximum number of Articles to process in one run (default: 50). */
  batchLimit?: number;
  /** Force re-clustering even if Article is already clustered. */
  force?: boolean;
  /** Specific Article IDs to process (overrides eligibility filters). */
  articleIds?: string[];
}

const JOB_NAME = 'cluster';
const DEFAULT_BATCH_LIMIT = 50;

/**
 * Run the bounded clustering job. Processes eligible Articles (not yet
 * clustered or with outdated clustering), isolating per-Article failures.
 *
 * @param pool - Database pool.
 * @param options - Batch limits and article selection.
 * @returns JobOutcome with per-Article results.
 */
export async function runClusteringJob(
  pool: Pool,
  options: ClusteringJobOptions = {},
): Promise<JobOutcome> {
  const startedAt = new Date();

  // Resolve embedding provider (fake by default).
  const embeddingProvider = resolveEmbeddingProvider();

  const articleRepo = new ArticleRepository(pool);
  const decisionRepo = new ClusteringDecisionRepository(pool);

  // Select Articles to process.
  let articles;
  if (options.articleIds && options.articleIds.length > 0) {
    // Explicit article IDs (admin manual trigger or targeted run).
    articles = await Promise.all(
      options.articleIds.map((id) => articleRepo.findById(id)),
    );
    articles = articles.filter((a) => a !== null);
  } else {
    // Default: find Articles eligible for clustering.
    articles = await findEligibleArticles(
      articleRepo,
      pool,
      options.batchLimit ?? DEFAULT_BATCH_LIMIT,
      options.force ?? false,
    );
  }

  const attempted = articles.length;
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  let retryableFailures = 0;
  const failures: ItemFailure[] = [];

  // Process each Article through the Stage 7 clustering engine.
  for (const article of articles) {
    if (!article) continue;

    try {
      const result = await clusterArticle(article.id, {
        embeddingProvider,
        force: options.force,
      } as any);

      // Any non-error outcome counts as succeeded (CREATED_STORY, ASSIGNED_EXISTING, AMBIGUOUS, SKIPPED_PROTECTED).
      succeeded += 1;

      // AMBIGUOUS and SKIPPED_PROTECTED are recorded decisions, not failures.
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('not eligible') || errorMessage.includes('not found')) {
        skipped += 1;
      } else {
        failed += 1;
        // Clustering errors are generally non-retryable (data issues, logic errors).
        failures.push({
          itemId: article.id,
          itemType: 'Article',
          error: errorMessage,
          retryable: false,
          context: { articleTitle: article.original_title },
        });
      }
    }
  }

  const finishedAt = new Date();
  const errorSummary = buildErrorSummary(failures);
  const metadata = {
    batchLimit: options.batchLimit ?? DEFAULT_BATCH_LIMIT,
    force: options.force ?? false,
    embeddingProvider: embeddingProvider.name,
    embeddingModel: embeddingProvider.model,
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
    reason: errorSummary ?? 'All Articles failed clustering.',
  };
}

/**
 * Find Articles eligible for clustering:
 *  - Not already clustered (or force=true)
 *  - Has required text fields
 *  - Not HIDDEN or DUPLICATE
 *
 * Bounded by batchLimit.
 */
async function findEligibleArticles(
  articleRepo: ArticleRepository,
  pool: Pool,
  batchLimit: number,
  force: boolean,
): Promise<Array<NonNullable<Awaited<ReturnType<typeof articleRepo.findById>>>>> {
  // Fetch recent Articles by querying directly.
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM articles
     WHERE status NOT IN ('HIDDEN', 'DUPLICATE')
     ORDER BY discovered_at DESC
     LIMIT $1`,
    [batchLimit * 2],
  );

  const eligible = [];

  for (const row of result.rows) {
    const article = await articleRepo.findById(row.id);
    if (!article) continue;

    // Check basic eligibility (has text, not excluded status).
    const eligibility = isEligibleForClustering(article);
    if (!eligibility.eligible) continue;

    // Check if already clustered (unless force=true).
    if (!force) {
      const storyResult = await pool.query<{ story_id: string }>(
        `SELECT story_id FROM story_articles WHERE article_id = $1 LIMIT 1`,
        [article.id],
      );
      if (storyResult.rows.length > 0) {
        // Already clustered; skip.
        continue;
      }
    }

    eligible.push(article);
    if (eligible.length >= batchLimit) break;
  }

  return eligible;
}

/**
 * Build a human-readable summary of clustering failures.
 */
function buildErrorSummary(failures: ItemFailure[]): string | null {
  if (failures.length === 0) return null;

  const first3 = failures.slice(0, 3).map((f) => {
    const title = f.context?.articleTitle ?? f.itemId;
    return `${title}: ${f.error}`;
  });

  let summary = `${failures.length} Article(s) failed clustering. `;
  summary += first3.join('; ');
  if (failures.length > 3) {
    summary += `; and ${failures.length - 3} more.`;
  }

  return summary;
}
