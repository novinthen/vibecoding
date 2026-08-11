/**
 * Stage 9A — Bounded ingestion job.
 *
 * Automated job that processes enabled Sources through the existing Stage 3
 * ingestion pipeline. Respects Source health, supports batch limits, and
 * isolates per-Source failures so one broken Source does not crash the batch.
 *
 * Reuses the Stage 3 ingestion engine unchanged (no business logic duplication).
 */

import type { Pool } from 'pg';

import { ArticleRepository } from '@/domain/repositories/article-repository';
import { SourceFetchRepository } from '@/domain/repositories/source-fetch-repository';
import { SourceRepository } from '@/domain/repositories/source-repository';
import { ingestSource } from '@/ingestion/ingest';

import { buildJobResult } from './job-runner';
import type { ItemFailure, JobOutcome } from './types';

export interface IngestionJobOptions {
  /** Maximum number of Sources to process in one run (default: 50). */
  batchLimit?: number;
  /** Minimum health threshold (default: include HEALTHY, DEGRADED, UNKNOWN). */
  minHealth?: 'HEALTHY' | 'DEGRADED' | 'UNKNOWN';
  /** Specific Source IDs to process (overrides enabled/health filters, max 100). */
  sourceIds?: string[];
}

const JOB_NAME = 'ingest';
const DEFAULT_BATCH_LIMIT = 50;
const MAX_EXPLICIT_IDS = 100;

/**
 * Run the bounded ingestion job. Processes enabled Sources (respecting health
 * and batch limits), isolating per-Source failures.
 *
 * @param pool - Database pool.
 * @param options - Batch limits, health filters, and source selection.
 * @returns JobOutcome with per-Source results.
 */
export async function runIngestionJob(
  pool: Pool,
  options: IngestionJobOptions = {},
): Promise<JobOutcome> {
  const startedAt = new Date();

  const sourceRepo = new SourceRepository(pool);
  const articleRepo = new ArticleRepository(pool);
  const sourceFetchRepo = new SourceFetchRepository(pool);

  // Select Sources to process.
  let sources;
  if (options.sourceIds && options.sourceIds.length > 0) {
    // Explicit source IDs (admin manual trigger or targeted run).
    // Cap to prevent unbounded explicit ID lists.
    const cappedIds = options.sourceIds.slice(0, MAX_EXPLICIT_IDS);
    sources = await Promise.all(
      cappedIds.map((id) => sourceRepo.findById(id)),
    );
    sources = sources.filter((s) => s !== null);
  } else {
    // Default: enabled Sources with acceptable health.
    const allSources = await sourceRepo.listEnabled();
    sources = allSources.filter((s) => {
      if (!s.enabled) return false;
      const minHealth = options.minHealth ?? 'UNKNOWN';
      if (minHealth === 'HEALTHY') {
        return s.health_status === 'HEALTHY';
      }
      if (minHealth === 'DEGRADED') {
        return (
          s.health_status === 'HEALTHY' || s.health_status === 'DEGRADED'
        );
      }
      // UNKNOWN: include HEALTHY, DEGRADED, UNKNOWN (exclude FAILING, DISABLED).
      return (
        s.health_status === 'HEALTHY' ||
        s.health_status === 'DEGRADED' ||
        s.health_status === 'UNKNOWN'
      );
    });
  }

  // Apply batch limit (always enforce a finite bound).
  const batchLimit = options.batchLimit ?? DEFAULT_BATCH_LIMIT;
  sources = sources.slice(0, batchLimit);

  const attempted = sources.length;
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  let retryableFailures = 0;
  const failures: ItemFailure[] = [];

  // Process each Source through the Stage 3 ingestion pipeline.
  for (const source of sources) {
    try {
      const result = await ingestSource(source, {
        articles: articleRepo,
        sourceFetches: sourceFetchRepo,
        sources: sourceRepo,
      });

      if (result.status === 'SUCCESS') {
        succeeded += 1;
      } else if (result.status === 'SKIPPED') {
        skipped += 1;
      } else if (result.status === 'FAILED') {
        failed += 1;
        const retryable = result.errorCode
          ? isRetryableIngestError(result.errorCode)
          : false;
        if (retryable) retryableFailures += 1;
        failures.push({
          itemId: source.id,
          itemType: 'Source',
          error: result.errorMessage ?? 'Unknown ingestion error',
          retryable,
          context: {
            sourceName: source.name,
            errorCode: result.errorCode,
            httpStatus: result.httpStatus,
          },
        });
      } else if (result.status === 'PARTIAL') {
        // PARTIAL counts as succeeded (some items ingested).
        succeeded += 1;
      }
    } catch (error) {
      // Unexpected error (should not happen; ingestSource isolates failures).
      failed += 1;
      failures.push({
        itemId: source.id,
        itemType: 'Source',
        error: error instanceof Error ? error.message : 'Unknown error',
        retryable: false,
        context: { sourceName: source.name },
      });
    }
  }

  const finishedAt = new Date();
  const errorSummary = buildErrorSummary(failures);
  const metadata = {
    batchLimit,
    minHealth: options.minHealth ?? 'UNKNOWN',
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
    reason: errorSummary ?? 'All Sources failed.',
  };
}

/**
 * Classify ingestion error codes as retryable or non-retryable.
 * Retryable: network timeouts, rate limits, server errors.
 * Non-retryable: invalid config, malformed URLs, auth errors.
 */
function isRetryableIngestError(errorCode: string): boolean {
  const retryableCodes = [
    'FETCH_TIMEOUT',
    'FETCH_ERROR',
    'DNS_ERROR',
    'HTTP_5XX',
    'RATE_LIMIT',
  ];
  return retryableCodes.includes(errorCode);
}

/**
 * Build a human-readable summary of failures (first few errors + counts).
 */
function buildErrorSummary(failures: ItemFailure[]): string | null {
  if (failures.length === 0) return null;

  const retryableCount = failures.filter((f) => f.retryable).length;
  const nonRetryableCount = failures.length - retryableCount;

  const first3 = failures.slice(0, 3).map((f) => {
    const sourceName = f.context?.sourceName ?? f.itemId;
    return `${sourceName}: ${f.error}`;
  });

  let summary = `${failures.length} Source(s) failed`;
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
