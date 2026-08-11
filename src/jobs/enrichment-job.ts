/**
 * Stage 9A — Bounded enrichment job.
 *
 * Automated job that processes Articles through the Stage 6 AI enrichment
 * pipeline. Eligibility is conservative (unenriched Articles with current
 * schema version), batch-limited, and per-Article failures are isolated.
 *
 * Reuses the Stage 6 enrichment service unchanged.
 */

import type { Pool } from 'pg';

import { buildProvider } from '@/ai/config';
import { enrichArticle, isEligibleForEnrichment } from '@/ai/enrichment/service';
import { ArticleRepository } from '@/domain/repositories/article-repository';
import { ArticleEnrichmentRepository } from '@/domain/repositories/article-enrichment-repository';

import { buildJobResult } from './job-runner';
import type { ItemFailure, JobOutcome } from './types';

export interface EnrichmentJobOptions {
  /** Maximum number of Articles to process in one run (default: 100). */
  batchLimit?: number;
  /** Force re-enrichment even if current enrichment exists. */
  force?: boolean;
  /** Specific Article IDs to process (overrides eligibility filters, max 100). */
  articleIds?: string[];
}

const JOB_NAME = 'enrich';
const DEFAULT_BATCH_LIMIT = 100;
const MAX_EXPLICIT_IDS = 100;

/**
 * Run the bounded enrichment job. Processes eligible Articles (unenriched or
 * outdated enrichments), isolating per-Article failures.
 *
 * @param pool - Database pool.
 * @param options - Batch limits and article selection.
 * @returns JobOutcome with per-Article results.
 */
export async function runEnrichmentJob(
  pool: Pool,
  options: EnrichmentJobOptions = {},
): Promise<JobOutcome> {
  const startedAt = new Date();

  // Resolve AI provider (may be fake or real Anthropic).
  const provider = buildProvider(
    process.env.AI_PROVIDER === 'anthropic'
      ? { provider: 'anthropic', model: process.env.AI_MODEL || 'claude-3-5-sonnet-20241022', apiKey: process.env.AI_API_KEY }
      : { provider: 'fake', model: 'fake-model' }
  );

  const articleRepo = new ArticleRepository(pool);
  const enrichmentRepo = new ArticleEnrichmentRepository(pool);

  // Select Articles to process.
  let articles;
  if (options.articleIds && options.articleIds.length > 0) {
    // Explicit article IDs (admin manual trigger or targeted run).
    // Cap to prevent unbounded explicit ID lists.
    const cappedIds = options.articleIds.slice(0, MAX_EXPLICIT_IDS);
    articles = await Promise.all(
      cappedIds.map((id) => articleRepo.findById(id)),
    );
    articles = articles.filter((a) => a !== null);
  } else {
    // Default: find Articles eligible for enrichment.
    articles = await findEligibleArticles(
      articleRepo,
      enrichmentRepo,
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

  // Process each Article through the Stage 6 enrichment service.
  for (const article of articles) {
    if (!article) continue;

    try {
      const result = await enrichArticle(provider, article.id, {
        force: options.force,
      }, { pool });

      if (result.outcome === 'SUCCEEDED') {
        succeeded += 1;
      } else if (result.outcome === 'INVALID_OUTPUT') {
        // Invalid output is recorded but counts as a non-retryable failure.
        failed += 1;
        failures.push({
          itemId: article.id,
          itemType: 'Article',
          error: `Invalid AI output: ${result.validationError}`,
          retryable: false,
          context: {
            articleTitle: article.original_title,
            validationError: result.validationError,
          },
        });
      } else if (result.outcome === 'PROVIDER_ERROR') {
        failed += 1;
        if (result.retryable) retryableFailures += 1;
        failures.push({
          itemId: article.id,
          itemType: 'Article',
          error: `Provider error: ${result.errorCode}`,
          retryable: result.retryable,
          context: {
            articleTitle: article.original_title,
            errorCode: result.errorCode,
          },
        });
      }
    } catch (error) {
      // Ineligible or article not found (should be filtered earlier).
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('not eligible')) {
        skipped += 1;
      } else {
        failed += 1;
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
    providerName: provider.name,
    providerModel: provider.model,
    failures: failures.slice(0, 10), // Keep first 10 for debugging.
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
    reason: errorSummary ?? 'All Articles failed enrichment.',
  };
}

/**
 * Find Articles eligible for enrichment:
 *  - Not HIDDEN or DUPLICATE
 *  - Has text content
 *  - No current enrichment (or force=true)
 *
 * Bounded by batchLimit.
 */
async function findEligibleArticles(
  articleRepo: ArticleRepository,
  enrichmentRepo: ArticleEnrichmentRepository,
  batchLimit: number,
  force: boolean,
): Promise<Array<NonNullable<Awaited<ReturnType<typeof articleRepo.findById>>>>> {
  // Fetch recent Articles by querying directly (no listRecent method exists).
  const result = await articleRepo['db'].query<{ id: string }>(
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
    const eligibility = isEligibleForEnrichment(article);
    if (!eligibility.eligible) continue;

    // Check if already enriched (unless force=true).
    if (!force) {
      const latest = await enrichmentRepo.findLatest(article.id);
      if (latest && latest.status === 'SUCCEEDED') {
        // Already enriched successfully; skip.
        continue;
      }
    }

    eligible.push(article);
    if (eligible.length >= batchLimit) break;
  }

  return eligible;
}

/**
 * Build a human-readable summary of enrichment failures.
 */
function buildErrorSummary(failures: ItemFailure[]): string | null {
  if (failures.length === 0) return null;

  const retryableCount = failures.filter((f) => f.retryable).length;
  const nonRetryableCount = failures.length - retryableCount;

  const first3 = failures.slice(0, 3).map((f) => {
    const title = f.context?.articleTitle ?? f.itemId;
    return `${title}: ${f.error}`;
  });

  let summary = `${failures.length} Article(s) failed enrichment`;
  if (retryableCount > 0) {
    summary += ` (${retryableCount} retryable)`;
  }
  if (nonRetryableCount > 0) {
    summary += ` (${nonRetryableCount} non-retryable)`;
  }
  summary += '. ';
  summary += first3.join('; ');
  if (failures.length > 3) {
    summary += `; and ${failures.length - 3} more.`;
  }

  return summary;
}
