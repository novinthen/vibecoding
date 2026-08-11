/**
 * Stage 9A — Pipeline orchestrator.
 *
 * Coordinates the full intelligence pipeline in sequence: ingestion →
 * enrichment → clustering → ranking. Each stage is independently runnable, but
 * the pipeline provides a single entry point for scheduled runs.
 *
 * Pipeline behavior:
 *  - Runs stages in order (each stage depends on prior stages' output).
 *  - Individual item failures are isolated (one bad Article/Story doesn't fail the batch).
 *  - Stage-level partial failures are reported but allow continuation.
 *  - Systemic failures (entire stage fails) stop the pipeline and report.
 */

import type { Pool } from 'pg';

import { runClusteringJob, type ClusteringJobOptions } from './clustering-job';
import { runEnrichmentJob, type EnrichmentJobOptions } from './enrichment-job';
import { runIngestionJob, type IngestionJobOptions } from './ingestion-job';
import { buildJobResult } from './job-runner';
import { runRankingJob, type RankingJobOptions } from './ranking-job';
import type { JobOutcome } from './types';

export interface PipelineJobOptions {
  ingestion?: IngestionJobOptions;
  enrichment?: EnrichmentJobOptions;
  clustering?: ClusteringJobOptions;
  ranking?: RankingJobOptions;
  /** Stop pipeline on partial failure (default: false, continue on partial). */
  stopOnPartial?: boolean;
}

const JOB_NAME = 'pipeline';

/**
 * Run the full intelligence pipeline: ingest → enrich → cluster → rank.
 * Each stage is independently bounded and isolated. Returns a combined outcome
 * with per-stage results.
 *
 * @param pool - Database pool.
 * @param options - Per-stage options and pipeline behavior.
 * @returns Combined job outcome.
 */
export async function runPipelineJob(
  pool: Pool,
  options: PipelineJobOptions = {},
): Promise<JobOutcome> {
  const startedAt = new Date();
  const stageResults: Array<{ stage: string; outcome: JobOutcome }> = [];

  // Stage 1: Ingestion
  console.log('[Pipeline] Stage 1: Ingestion');
  const ingestionOutcome = await runIngestionJob(pool, options.ingestion);
  stageResults.push({ stage: 'ingestion', outcome: ingestionOutcome });

  if (shouldStopPipeline(ingestionOutcome, options.stopOnPartial)) {
    return buildPipelineOutcome(
      startedAt,
      stageResults,
      'Pipeline stopped after ingestion failure.',
    );
  }

  // Stage 2: Enrichment
  console.log('[Pipeline] Stage 2: Enrichment');
  const enrichmentOutcome = await runEnrichmentJob(pool, options.enrichment);
  stageResults.push({ stage: 'enrichment', outcome: enrichmentOutcome });

  if (shouldStopPipeline(enrichmentOutcome, options.stopOnPartial)) {
    return buildPipelineOutcome(
      startedAt,
      stageResults,
      'Pipeline stopped after enrichment failure.',
    );
  }

  // Stage 3: Clustering
  console.log('[Pipeline] Stage 3: Clustering');
  const clusteringOutcome = await runClusteringJob(pool, options.clustering);
  stageResults.push({ stage: 'clustering', outcome: clusteringOutcome });

  if (shouldStopPipeline(clusteringOutcome, options.stopOnPartial)) {
    return buildPipelineOutcome(
      startedAt,
      stageResults,
      'Pipeline stopped after clustering failure.',
    );
  }

  // Stage 4: Ranking
  console.log('[Pipeline] Stage 4: Ranking');
  const rankingOutcome = await runRankingJob(pool, options.ranking);
  stageResults.push({ stage: 'ranking', outcome: rankingOutcome });

  return buildPipelineOutcome(startedAt, stageResults, null);
}

/**
 * Determine if pipeline should stop based on stage outcome and policy.
 * Stops on FAILED (systemic); optionally stops on PARTIAL.
 */
function shouldStopPipeline(
  outcome: JobOutcome,
  stopOnPartial: boolean = false,
): boolean {
  if (outcome.kind === 'FAILED') return true;
  if (stopOnPartial && outcome.kind === 'PARTIAL') return true;
  return false;
}

/**
 * Build a combined pipeline outcome from individual stage results.
 */
function buildPipelineOutcome(
  startedAt: Date,
  stageResults: Array<{ stage: string; outcome: JobOutcome }>,
  earlyStopReason: string | null,
): JobOutcome {
  const finishedAt = new Date();

  // Aggregate counters across all stages.
  let attempted = 0;
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  let retryableFailures = 0;

  for (const { outcome } of stageResults) {
    attempted += outcome.result.attempted;
    succeeded += outcome.result.succeeded;
    skipped += outcome.result.skipped;
    failed += outcome.result.failed;
    retryableFailures += outcome.result.retryableFailures;
  }

  const stageSummaries = stageResults.map(({ stage, outcome }) => {
    return `${stage}: ${outcome.result.status} (${outcome.result.succeeded}/${outcome.result.attempted})`;
  });

  const errorSummary = earlyStopReason
    ? `${earlyStopReason} Stages: ${stageSummaries.join(', ')}`
    : `Pipeline completed. Stages: ${stageSummaries.join(', ')}`;

  const metadata = {
    stagesRun: stageResults.length,
    stageResults: stageResults.map(({ stage, outcome }) => ({
      stage,
      status: outcome.result.status,
      attempted: outcome.result.attempted,
      succeeded: outcome.result.succeeded,
      failed: outcome.result.failed,
      errorSummary: outcome.result.errorSummary,
    })),
    earlyStop: earlyStopReason !== null,
  };

  const result = buildJobResult(
    JOB_NAME,
    startedAt,
    finishedAt,
    { attempted, succeeded, skipped, failed, retryableFailures },
    errorSummary,
    metadata,
  );

  // Pipeline outcome is SUCCESS if all stages succeeded, PARTIAL if any stage
  // had partial failures, or FAILED if any stage failed systemically.
  if (result.status === 'SUCCEEDED') {
    return { kind: 'SUCCESS', result };
  }
  if (result.status === 'PARTIAL') {
    return {
      kind: 'PARTIAL',
      result,
      failures: [], // Failures are in stage-specific metadata
    };
  }
  return {
    kind: 'FAILED',
    result,
    reason: errorSummary,
  };
}
