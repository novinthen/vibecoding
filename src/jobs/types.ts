/**
 * Stage 9A — Job orchestration types.
 *
 * Common result shapes, status enums, and error classifications for the
 * production automation layer. Jobs are bounded, idempotent operations that
 * call existing Stage 3/6/7/8 engines without duplicating business logic.
 */

export type JobStatus = 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';

export interface JobResult {
  jobName: string;
  status: JobStatus;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  attempted: number;
  succeeded: number;
  skipped: number;
  failed: number;
  /** Subset of failures that are retryable (network/rate-limit/transient). */
  retryableFailures: number;
  /** Human-readable summary of the run. */
  errorSummary: string | null;
  /** Structured metadata for debugging/audit. */
  metadata: Record<string, unknown> | null;
}

/**
 * A failure from processing one item (Source/Article/Story). Jobs isolate
 * per-item failures so one bad item does not crash the entire batch.
 */
export interface ItemFailure {
  itemId: string;
  itemType: string;
  error: string;
  retryable: boolean;
  /** Structured context (error code, HTTP status, etc.). */
  context?: Record<string, unknown>;
}

/**
 * Lightweight in-memory lock result. Jobs check this before starting to
 * prevent overlapping runs of the same job.
 */
export interface JobLockResult {
  acquired: boolean;
  /** If not acquired, the holder's start time (for diagnostics). */
  heldSince?: Date;
}

/**
 * Discriminated union for job outcomes: success, partial (some items failed
 * but the job completed), or systemic failure (the job itself could not run).
 */
export type JobOutcome =
  | { kind: 'SUCCESS'; result: JobResult }
  | { kind: 'PARTIAL'; result: JobResult; failures: ItemFailure[] }
  | { kind: 'FAILED'; result: JobResult; reason: string };
