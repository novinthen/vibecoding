/**
 * Stage 9A — PostgreSQL-native job locking.
 *
 * Uses advisory locks to prevent overlapping runs of the same job. Advisory
 * locks are session-scoped and automatically released on connection close or
 * transaction end, so crashed jobs do not leave stale locks.
 *
 * Each job has a unique integer key derived from its name hash. Unrelated jobs
 * may run concurrently; only the same job name is serialized.
 */

import type { Db } from '@/db/client';

import type { JobLockResult } from './types';

/**
 * Job lock namespace. Advisory lock keys are 64-bit integers; we use the high
 * 32 bits as a namespace to avoid collisions with other advisory lock uses.
 */
const JOB_LOCK_NAMESPACE = 0x564a4f42; // 'VJOB' in hex

/**
 * Try to acquire an advisory lock for the given job name. Returns immediately
 * (non-blocking). If acquired, the lock is held until the connection is
 * released or an explicit unlock.
 *
 * Advisory locks are session-scoped: they survive COMMIT/ROLLBACK and are
 * released when the connection is returned to the pool or the session ends.
 * A crashed job releases its lock automatically when the connection dies.
 *
 * @param db - Database connection (must be from a pool, not a transaction).
 * @param jobName - Unique job identifier (e.g., 'ingest', 'enrich').
 * @returns Lock result with acquisition status.
 */
export async function tryAcquireJobLock(
  db: Db,
  jobName: string,
): Promise<JobLockResult> {
  const lockKey = jobNameToLockKey(jobName);

  // pg_try_advisory_lock returns true if acquired, false if already held.
  const result = await db.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_lock($1, $2) AS acquired',
    [JOB_LOCK_NAMESPACE, lockKey],
  );

  const acquired = result.rows[0]?.acquired ?? false;

  if (acquired) {
    return { acquired: true };
  }

  // Lock not acquired; return diagnostic info (lock is held by another session).
  // We cannot reliably get the holder's start time from advisory locks alone,
  // so we return a placeholder. Job run persistence will provide full history.
  return {
    acquired: false,
    heldSince: new Date(), // Placeholder; real runs are in job_runs table.
  };
}

/**
 * Release the advisory lock for the given job name. Should be called when the
 * job completes (success or failure). If not called explicitly, the lock is
 * released when the connection is returned to the pool.
 *
 * @param db - Database connection that holds the lock.
 * @param jobName - Job identifier (must match the acquire call).
 */
export async function releaseJobLock(
  db: Db,
  jobName: string,
): Promise<void> {
  const lockKey = jobNameToLockKey(jobName);
  await db.query('SELECT pg_advisory_unlock($1, $2)', [
    JOB_LOCK_NAMESPACE,
    lockKey,
  ]);
}

/**
 * Derive a stable 32-bit integer from a job name for use as the low 32 bits of
 * the advisory lock key. Uses a simple hash (djb2) that is deterministic and
 * collision-resistant for small sets of job names.
 */
function jobNameToLockKey(jobName: string): number {
  let hash = 5381;
  for (let i = 0; i < jobName.length; i++) {
    hash = (hash * 33) ^ jobName.charCodeAt(i);
  }
  // Clamp to signed 32-bit range for PostgreSQL integer type.
  return (hash >>> 0) & 0x7fffffff;
}
