/**
 * Stage 9A — Job run persistence repository.
 *
 * Provides data access for job_runs table: create, update, and query recent
 * job history. Supports operational queries (currently running, last success,
 * recent runs) without storing unbounded logs.
 */

import type { Db } from '@/db/client';

import type { JobResult, JobStatus } from './types';

export interface JobRunRow {
  id: string;
  job_name: string;
  status: JobStatus;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  attempted: number;
  succeeded: number;
  skipped: number;
  failed: number;
  retryable_failures: number;
  error_summary: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface CreateJobRunInput {
  jobName: string;
  startedAt: Date;
}

export interface CompleteJobRunInput {
  status: JobStatus;
  finishedAt: Date;
  durationMs: number;
  attempted: number;
  succeeded: number;
  skipped: number;
  failed: number;
  retryableFailures: number;
  errorSummary: string | null;
  metadata: Record<string, unknown> | null;
}

export class JobRunRepository {
  constructor(private readonly db: Db) {}

  /**
   * Create a new job run with status RUNNING. Returns the persisted row.
   * Call completeJobRun() when the job finishes to update the outcome.
   */
  async createJobRun(input: CreateJobRunInput): Promise<JobRunRow> {
    const result = await this.db.query<JobRunRow>(
      `INSERT INTO job_runs (job_name, status, started_at)
       VALUES ($1, 'RUNNING', $2)
       RETURNING *`,
      [input.jobName, input.startedAt.toISOString()],
    );
    return result.rows[0]!;
  }

  /**
   * Update a running job with its final outcome. Sets status, finished_at,
   * duration, counts, and error summary.
   */
  async completeJobRun(
    id: string,
    input: CompleteJobRunInput,
  ): Promise<JobRunRow> {
    const result = await this.db.query<JobRunRow>(
      `UPDATE job_runs
       SET status = $2,
           finished_at = $3,
           duration_ms = $4,
           attempted = $5,
           succeeded = $6,
           skipped = $7,
           failed = $8,
           retryable_failures = $9,
           error_summary = $10,
           metadata = $11
       WHERE id = $1
       RETURNING *`,
      [
        id,
        input.status,
        input.finishedAt.toISOString(),
        input.durationMs,
        input.attempted,
        input.succeeded,
        input.skipped,
        input.failed,
        input.retryableFailures,
        input.errorSummary,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ],
    );
    return result.rows[0]!;
  }

  /**
   * Find the most recent job run (any status) for a given job name.
   * Returns null if no runs exist.
   */
  async findLatestRun(jobName: string): Promise<JobRunRow | null> {
    const result = await this.db.query<JobRunRow>(
      `SELECT * FROM job_runs
       WHERE job_name = $1
       ORDER BY started_at DESC
       LIMIT 1`,
      [jobName],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Find the most recent successful run for a given job name.
   * Returns null if no successful runs exist.
   */
  async findLastSuccessfulRun(jobName: string): Promise<JobRunRow | null> {
    const result = await this.db.query<JobRunRow>(
      `SELECT * FROM job_runs
       WHERE job_name = $1 AND status = 'SUCCEEDED'
       ORDER BY finished_at DESC
       LIMIT 1`,
      [jobName],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Find any currently running job with the given name.
   * Returns null if no job is currently running.
   */
  async findRunningJob(jobName: string): Promise<JobRunRow | null> {
    const result = await this.db.query<JobRunRow>(
      `SELECT * FROM job_runs
       WHERE job_name = $1 AND status = 'RUNNING'
       ORDER BY started_at DESC
       LIMIT 1`,
      [jobName],
    );
    return result.rows[0] ?? null;
  }

  /**
   * List recent job runs (all jobs, any status), most recent first.
   * Limited to prevent unbounded queries.
   */
  async listRecentRuns(limit = 50): Promise<JobRunRow[]> {
    const result = await this.db.query<JobRunRow>(
      `SELECT * FROM job_runs
       ORDER BY started_at DESC
       LIMIT $1`,
      [Math.min(limit, 200)], // Cap at 200 even if caller requests more
    );
    return result.rows;
  }

  /**
   * List recent runs for a specific job, most recent first.
   */
  async listRunsForJob(jobName: string, limit = 20): Promise<JobRunRow[]> {
    const result = await this.db.query<JobRunRow>(
      `SELECT * FROM job_runs
       WHERE job_name = $1
       ORDER BY started_at DESC
       LIMIT $2`,
      [jobName, Math.min(limit, 100)],
    );
    return result.rows;
  }

  /**
   * Convert JobResult to CompleteJobRunInput. Helper for job implementations.
   */
  static resultToCompleteInput(result: JobResult): CompleteJobRunInput {
    return {
      status: result.status,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      attempted: result.attempted,
      succeeded: result.succeeded,
      skipped: result.skipped,
      failed: result.failed,
      retryableFailures: result.retryableFailures,
      errorSummary: result.errorSummary,
      metadata: result.metadata,
    };
  }
}
