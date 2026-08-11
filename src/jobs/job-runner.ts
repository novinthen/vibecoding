/**
 * Stage 9A — Job runner coordinator.
 *
 * Provides the common lifecycle for all automated jobs: lock acquisition, run
 * persistence, error handling, and lock cleanup. Individual job implementations
 * provide the work function; the runner handles the boilerplate.
 *
 * Guarantees:
 *  - overlapping runs of the same job are prevented (advisory lock);
 *  - every run creates exactly one job_runs row (even on failure);
 *  - locks are released after job completion (success or failure);
 *  - partial failures are recorded but do not prevent completion.
 */

import type { Pool } from 'pg';

import { getPool } from '@/db/client';

import { JobRunRepository } from './job-run-repository';
import { tryAcquireJobLock, type JobLock } from './locking';
import type { JobOutcome, JobResult, JobStatus } from './types';

export interface RunJobOptions {
  /** Database pool (defaults to shared pool). */
  pool?: Pool;
  /** Skip lock acquisition (dangerous; for controlled single-run contexts only). */
  skipLock?: boolean;
}

/**
 * Run a job with full lifecycle management: lock, persist, execute, complete.
 *
 * @param jobName - Unique job identifier (e.g., 'ingest', 'enrich').
 * @param work - The job implementation (receives pool, returns outcome).
 * @param options - Pool override and lock control.
 * @returns The final job outcome (success, partial, or failed).
 */
export async function runJob(
  jobName: string,
  work: (pool: Pool) => Promise<JobOutcome>,
  options: RunJobOptions = {},
): Promise<JobOutcome> {
  const pool = options.pool ?? getPool();
  const startedAt = new Date();

  // Attempt lock acquisition (unless skipLock is true).
  let lock: JobLock | null = null;
  if (!options.skipLock) {
    lock = await tryAcquireJobLock(pool, jobName);
    if (!lock) {
      // Job is already running; persist a SKIPPED job_run for observability.
      const jobRunRepo = new JobRunRepository(pool);
      const skippedRow = await jobRunRepo.createJobRun({ jobName, startedAt });
      await jobRunRepo.completeJobRun(skippedRow.id, {
        status: 'SKIPPED',
        finishedAt: new Date(),
        durationMs: 0,
        attempted: 0,
        succeeded: 0,
        skipped: 0,
        failed: 0,
        retryableFailures: 0,
        errorSummary: `Job '${jobName}' is already running. Skipped to prevent overlap.`,
        metadata: { reason: 'lock_held' },
      });

      return {
        kind: 'FAILED',
        result: {
          jobName,
          status: 'SKIPPED',
          startedAt,
          finishedAt: new Date(),
          durationMs: 0,
          attempted: 0,
          succeeded: 0,
          skipped: 0,
          failed: 0,
          retryableFailures: 0,
          errorSummary: `Job '${jobName}' is already running. Skipped to prevent overlap.`,
          metadata: { reason: 'lock_held' },
        },
        reason: 'Job is already running.',
      };
    }
  }

  const jobRunRepo = new JobRunRepository(pool);
  let runRow;

  try {
    // Create the job_runs row with status RUNNING.
    runRow = await jobRunRepo.createJobRun({ jobName, startedAt });

    // Execute the job work function.
    const outcome = await work(pool);

    // Update the job_runs row with the final outcome.
    const completeInput = JobRunRepository.resultToCompleteInput(
      outcome.result,
    );
    await jobRunRepo.completeJobRun(runRow.id, completeInput);

    return outcome;
  } catch (error) {
    // Systemic failure (the job itself could not run).
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    const failedResult: JobResult = {
      jobName,
      status: 'FAILED',
      startedAt,
      finishedAt,
      durationMs,
      attempted: 0,
      succeeded: 0,
      skipped: 0,
      failed: 0,
      retryableFailures: 0,
      errorSummary: `Systemic failure: ${errorMessage}`,
      metadata: { error: String(error) },
    };

    // Update the job_runs row if it was created; otherwise, create one.
    if (runRow) {
      await jobRunRepo.completeJobRun(
        runRow.id,
        JobRunRepository.resultToCompleteInput(failedResult),
      );
    } else {
      await jobRunRepo.createJobRun({ jobName, startedAt });
      const createdRow = await jobRunRepo.findRunningJob(jobName);
      if (createdRow) {
        await jobRunRepo.completeJobRun(
          createdRow.id,
          JobRunRepository.resultToCompleteInput(failedResult),
        );
      }
    }

    return {
      kind: 'FAILED',
      result: failedResult,
      reason: errorMessage,
    };
  } finally {
    // Release the advisory lock (if acquired).
    if (lock) {
      try {
        await lock.release();
      } catch (err) {
        console.error(`Failed to release lock for job '${jobName}':`, err);
      }
    }
  }
}

/**
 * Helper to build a JobResult from counters. Derives status from counts:
 *  - FAILED if attempted === failed (nothing succeeded)
 *  - PARTIAL if some items failed but others succeeded
 *  - SUCCEEDED if no failures
 */
export function buildJobResult(
  jobName: string,
  startedAt: Date,
  finishedAt: Date,
  counters: {
    attempted: number;
    succeeded: number;
    skipped: number;
    failed: number;
    retryableFailures: number;
  },
  errorSummary: string | null,
  metadata: Record<string, unknown> | null,
): JobResult {
  let status: JobStatus;
  if (counters.failed === 0) {
    status = 'SUCCEEDED';
  } else if (counters.failed === counters.attempted && counters.attempted > 0) {
    status = 'FAILED';
  } else {
    status = 'PARTIAL';
  }

  return {
    jobName,
    status,
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    attempted: counters.attempted,
    succeeded: counters.succeeded,
    skipped: counters.skipped,
    failed: counters.failed,
    retryableFailures: counters.retryableFailures,
    errorSummary,
    metadata,
  };
}
