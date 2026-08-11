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
import { runJob } from './job-runner';
import { runRankingJob, type RankingJobOptions } from './ranking-job';
import type { JobOutcome, JobResult, JobStatus } from './types';

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
 * Production entry point for the full pipeline.
 *
 * Wraps {@link runPipelineJob} in the common runner under the `pipeline` job
 * name, which is what creates BOTH:
 *  - the pipeline-level advisory lock (two full pipeline runs cannot overlap);
 *  - the parent `pipeline` job_run row (observability).
 *
 * Callers must use THIS function rather than {@link runPipelineJob} directly:
 * calling the inner function skips the pipeline lock and never records a parent
 * job_run. `runPipelineJob` remains exported as the inner work function so the
 * runner can supply the pooled connection, and so stage-ordering can be tested
 * in isolation.
 */
export async function runPipelineWithLock(
  pool: Pool,
  options: PipelineJobOptions = {},
): Promise<JobOutcome> {
  return runJob(JOB_NAME, async (p) => runPipelineJob(p, options), { pool });
}

/**
 * Run the full intelligence pipeline: ingest → enrich → cluster → rank.
 * Each stage runs through runJob() with its own lock, so pipeline stages
 * respect standalone job locks. Returns a combined outcome with per-stage
 * results in metadata.
 *
 * NOTE: this is the INNER work function — it does not take the pipeline-level
 * lock and does not create the parent `pipeline` job_run. Use
 * {@link runPipelineWithLock} from production/CLI callers.
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
 *
 * CRITICAL: Pipeline MUST stop if a required stage is SKIPPED (lock held).
 * Continuing would violate dependency ordering (ingest → enrich → cluster → rank).
 *
 * Example failure scenario if we continue:
 *   standalone ingestion running
 *   → pipeline starts
 *   → pipeline ingestion SKIPPED (lock held)
 *   → pipeline enrichment starts IMMEDIATELY
 *   → standalone ingestion still creating Articles
 *   → enrichment misses those Articles (dependency race)
 *
 * Stop conditions:
 * - SKIPPED: required stage lock is held, cannot proceed
 * - FAILED: systemic error (not partial item failures)
 * - PARTIAL: optionally stop if stopOnStageFailure=true
 */
function shouldStopPipeline(
  outcome: JobOutcome,
  stopOnStageFailure: boolean = false,
): boolean {
  // SKIPPED means the stage lock was held; we MUST stop (dependency ordering).
  if (outcome.result.status === 'SKIPPED') return true;

  // FAILED is a systemic error (not partial item failures).
  if (outcome.kind === 'FAILED') return true;

  // Optionally stop on PARTIAL (some items failed).
  if (stopOnStageFailure && outcome.kind === 'PARTIAL') return true;

  return false;
}

/**
 * Build a combined pipeline outcome from individual stage results.
 *
 * CRITICAL: Pipeline status logic must handle early stop due to SKIPPED stage.
 * A SKIPPED required stage (lock held) means the pipeline did NOT complete,
 * even if no individual items failed.
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

  // Check if any required stage was SKIPPED (lock held)
  const hasSkippedStage = stageResults.some(
    ({ outcome }) => outcome.result.status === 'SKIPPED',
  );

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
    reason: hasSkippedStage
      ? 'required_stage_locked'
      : earlyStopReason
        ? 'stage_failure'
        : null,
  };

  // Determine pipeline status
  let status: JobStatus;

  if (hasSkippedStage) {
    // CRITICAL: If any required stage was SKIPPED (lock held), pipeline is PARTIAL
    // even if no individual items failed. The pipeline did not complete.
    status = 'PARTIAL';
  } else if (failed === 0 && !earlyStopReason) {
    // Normal success: no failures, no early stop
    status = 'SUCCEEDED';
  } else if (failed === attempted && attempted > 0) {
    // Total failure: all items failed
    status = 'FAILED';
  } else {
    // Partial: some items failed
    status = 'PARTIAL';
  }

  const result: JobResult = {
    jobName: JOB_NAME,
    status,
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    attempted,
    succeeded,
    skipped,
    failed,
    retryableFailures,
    errorSummary,
    metadata,
  };

  // Pipeline outcome kind based on status
  if (status === 'SUCCEEDED') {
    return { kind: 'SUCCESS', result };
  }
  if (status === 'PARTIAL') {
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
