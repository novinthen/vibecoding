/**
 * Stage 9A — Pipeline orchestrator (stage-lock correct).
 *
 * Coordinates the full intelligence pipeline in sequence: ingestion →
 * enrichment → clustering → ranking. Each stage runs through the common
 * job runner with its own lock, so standalone jobs and pipeline stages
 * cannot overlap.
 *
 * Pipeline behavior:
 *  - Runs stages in order (each stage depends on prior stages' output).
 *  - Each stage uses runJob() for lock + job_runs lifecycle.
 *  - Individual item failures are isolated (one bad Article/Story doesn't fail the batch).
 *  - Stage-level partial failures are reported but allow continuation.
 *  - If a stage lock is already held, that stage is skipped (overlap prevented).
 */

import type { Pool } from 'pg';

import { runClusteringJob, type ClusteringJobOptions } from './clustering-job';
import { runEnrichmentJob, type EnrichmentJobOptions } from './enrichment-job';
import { runIngestionJob, type IngestionJobOptions } from './ingestion-job';
import { buildJobResult, runJob } from './job-runner';
import { runRankingJob, type RankingJobOptions } from './ranking-job';
import type { JobOutcome } from './types';

export interface PipelineJobOptions {
  ingestion?: IngestionJobOptions;
  enrichment?: EnrichmentJobOptions;
  clustering?: ClusteringJobOptions;
  ranking?: RankingJobOptions;
  /** Stop pipeline on stage failure (default: false, continue on partial). */
  stopOnStageFailure?: boolean;
}

const JOB_NAME = 'pipeline';

/**
 * Run the full intelligence pipeline: ingest → enrich → cluster → rank.
 * Each stage runs through runJob() with its own lock, so pipeline stages
 * respect standalone job locks. Returns a combined outcome with per-stage
 * results in metadata.
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
  const ingestionOutcome = await runJob(
    'ingest',
    async (p) => runIngestionJob(p, options.ingestion),
    { pool },
  );
  stageResults.push({ stage: 'ingestion', outcome: ingestionOutcome });

  if (shouldStopPipeline(ingestionOutcome, options.stopOnStageFailure)) {
    return buildPipelineOutcome(
      startedAt,
      stageResults,
      'Pipeline stopped after ingestion failure.',
    );
  }

  // Stage 2: Enrichment
  console.log('[Pipeline] Stage 2: Enrichment');
  const enrichmentOutcome = await runJob(
    'enrich',
    async (p) => runEnrichmentJob(p, options.enrichment),
    { pool },
  );
  stageResults.push({ stage: 'enrichment', outcome: enrichmentOutcome });

  if (shouldStopPipeline(enrichmentOutcome, options.stopOnStageFailure)) {
    return buildPipelineOutcome(
      startedAt,
      stageResults,
      'Pipeline stopped after enrichment failure.',
    );
  }

  // Stage 3: Clustering
  console.log('[Pipeline] Stage 3: Clustering');
  const clusteringOutcome = await runJob(
    'cluster',
    async (p) => runClusteringJob(p, options.clustering),
    { pool },
  );
  stageResults.push({ stage: 'clustering', outcome: clusteringOutcome });

  if (shouldStopPipeline(clusteringOutcome, options.stopOnStageFailure)) {
    return buildPipelineOutcome(
      startedAt,
      stageResults,
      'Pipeline stopped after clustering failure.',
    );
  }

  // Stage 4: Ranking
  console.log('[Pipeline] Stage 4: Ranking');
  const rankingOutcome = await runJob(
    'rank',
    async (p) => runRankingJob(p, options.ranking),
    { pool },
  );
  stageResults.push({ stage: 'ranking', outcome: rankingOutcome });

  return buildPipelineOutcome(startedAt, stageResults, null);
}

/**
 * Determine if pipeline should stop based on stage outcome and policy.
 * Stops on FAILED (systemic). SKIPPED (overlap) is not a failure.
 * Optionally stops on PARTIAL if stopOnStageFailure is true.
 */
function shouldStopPipeline(
  outcome: JobOutcome,
  stopOnStageFailure: boolean = false,
): boolean {
  // SKIPPED means the stage lock was held; not a failure, just overlap prevention.
  if (outcome.result.status === 'SKIPPED') return false;

  // FAILED is a systemic error (not partial item failures).
  if (outcome.kind === 'FAILED') return true;

  // Optionally stop on PARTIAL (some items failed).
  if (stopOnStageFailure && outcome.kind === 'PARTIAL') return true;

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
