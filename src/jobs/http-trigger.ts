import { timingSafeEqual } from 'node:crypto';

import type { Pool } from 'pg';

import { runClusteringJob } from './clustering-job';
import { runEnrichmentJob } from './enrichment-job';
import { runIngestionJob } from './ingestion-job';
import { runJob } from './job-runner';
import { runPipelineWithLock, type PipelineJobOptions } from './pipeline-job';
import { runRankingJob } from './ranking-job';
import type { JobOutcome } from './types';

/**
 * Production job-trigger seam (Stage 10).
 *
 * The Stage 9A job runner is invoked in production by an external scheduler
 * (Vercel Cron, GitHub Actions, or system cron) through a thin authenticated
 * HTTP endpoint (`/api/jobs/[job]`). This module holds the two pure, unit-testable
 * pieces of that endpoint — the job-name allowlist and the constant-time bearer
 * check — plus the dispatch that calls the EXISTING Stage 9A orchestration. No
 * new pipeline is introduced and overlap protection remains the job runner's
 * advisory-lock responsibility.
 */

/** The bounded set of jobs the trigger endpoint may run. */
export const TRIGGERABLE_JOBS = [
  'ingest',
  'enrich',
  'cluster',
  'rank',
  'pipeline',
] as const;

export type TriggerableJob = (typeof TRIGGERABLE_JOBS)[number];

/** True when `name` is one of the allowlisted triggerable jobs. */
export function isTriggerableJob(name: string): name is TriggerableJob {
  return (TRIGGERABLE_JOBS as readonly string[]).includes(name);
}

/**
 * Cron-safe pipeline batch sizes (Stage 10).
 *
 * The HTTP trigger runs inside the route's execution budget (`maxDuration = 60`,
 * see the route). Stage 9A's DEFAULT pipeline batches (ingestion 50, enrichment
 * 100, clustering 50, ranking 100) can far exceed 60s once real AI enrichment is
 * involved (up to 100 sequential provider calls). These deliberately small,
 * explicit batches keep a single triggered pipeline realistically bounded within
 * that budget. The pipeline is idempotent and re-runs every scheduled tick, so
 * bounding per-run throughput never loses work — it just spreads it across ticks.
 * Enrichment is the slowest stage (network AI), so it is the smallest.
 *
 * Operators who need higher throughput should schedule the individual stage
 * endpoints on their own cadences instead of the coordinated pipeline (see
 * docs/OPERATIONS.md), or raise the route's duration only if the hosting plan is
 * proven to support it.
 */
export const CRON_PIPELINE_OPTIONS: PipelineJobOptions = {
  ingestion: { batchLimit: 5 },
  enrichment: { batchLimit: 3 },
  clustering: { batchLimit: 25 },
  ranking: { batchLimit: 25 },
};

/**
 * Constant-time check of an `Authorization: Bearer <secret>` header against the
 * configured secret. Fails closed: returns false when the secret is unset
 * (unconfigured deployment), the header is missing, or the value does not match.
 * The comparison is length-safe and constant-time to avoid leaking the secret
 * through timing.
 */
export function isAuthorizedTrigger(
  authorizationHeader: string | null | undefined,
  secret: string | null | undefined,
): boolean {
  if (!secret) return false;
  if (!authorizationHeader) return false;
  const expected = `Bearer ${secret}`;
  const provided = Buffer.from(authorizationHeader);
  const expectedBuf = Buffer.from(expected);
  if (provided.length !== expectedBuf.length) return false;
  return timingSafeEqual(provided, expectedBuf);
}

/**
 * Injectable job runners (test seam only). Production passes nothing, so the real
 * Stage 9A orchestration is used. Lets a unit test assert the trigger forwards the
 * bounded {@link CRON_PIPELINE_OPTIONS} instead of Stage 9A's large defaults,
 * without running a real pipeline.
 */
export interface TriggerRunners {
  pipeline?: (pool: Pool, options?: PipelineJobOptions) => Promise<JobOutcome>;
}

/**
 * Run one allowlisted job through the existing Stage 9A orchestration. Every
 * path takes the job's advisory lock (overlap protection) and records a
 * `job_runs` row; nothing here duplicates pipeline logic. The coordinated
 * `pipeline` run is bounded with the cron-safe batches so it fits the trigger
 * route's execution budget.
 */
export function runTriggerableJob(
  job: TriggerableJob,
  pool: Pool,
  runners: TriggerRunners = {},
): Promise<JobOutcome> {
  switch (job) {
    case 'ingest':
      return runJob('ingest', (p) => runIngestionJob(p), { pool });
    case 'enrich':
      return runJob('enrich', (p) => runEnrichmentJob(p), { pool });
    case 'cluster':
      return runJob('cluster', (p) => runClusteringJob(p), { pool });
    case 'rank':
      return runJob('rank', (p) => runRankingJob(p), { pool });
    case 'pipeline':
      return (runners.pipeline ?? runPipelineWithLock)(
        pool,
        CRON_PIPELINE_OPTIONS,
      );
  }
}

/**
 * Map a job outcome to an HTTP status. Derived from the job's terminal
 * `result.status`, NOT `outcome.kind`: healthy overlap prevention returns
 * `kind: FAILED` with `status: SKIPPED` (the lock was held), which is expected
 * behaviour — never a server error. Only a genuine `FAILED` status is 500.
 *
 *  - SUCCEEDED / PARTIAL / SKIPPED → 200 (success class)
 *  - FAILED → 500
 */
export function triggerHttpStatus(outcome: JobOutcome): number {
  return outcome.result.status === 'FAILED' ? 500 : 200;
}
