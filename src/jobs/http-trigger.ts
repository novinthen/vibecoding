import { timingSafeEqual } from 'node:crypto';

import type { Pool } from 'pg';

import { runClusteringJob } from './clustering-job';
import { runEnrichmentJob } from './enrichment-job';
import { runIngestionJob } from './ingestion-job';
import { runJob } from './job-runner';
import { runPipelineWithLock } from './pipeline-job';
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
 * Run one allowlisted job through the existing Stage 9A orchestration. Every
 * path takes the job's advisory lock (overlap protection) and records a
 * `job_runs` row; nothing here duplicates pipeline logic.
 */
export function runTriggerableJob(
  job: TriggerableJob,
  pool: Pool,
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
      return runPipelineWithLock(pool);
  }
}

/** Map a job outcome to an HTTP status: 200 for SUCCESS/PARTIAL, 500 for FAILED. */
export function triggerHttpStatus(outcome: JobOutcome): number {
  return outcome.kind === 'FAILED' ? 500 : 200;
}
