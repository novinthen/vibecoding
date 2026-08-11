/**
 * Stage 9A — PostgreSQL-native job locking (session-correct).
 *
 * Uses advisory locks to prevent overlapping runs of the same job. Advisory
 * locks are session-scoped and automatically released on connection close,
 * so crashed jobs do not leave stale locks.
 *
 * CRITICAL: Advisory locks are tied to a PostgreSQL session, not a transaction.
 * Pool.query() may execute on different sessions, so we MUST acquire a dedicated
 * PoolClient for the entire lock lifecycle.
 *
 * Each job has a unique integer key derived from its name hash. Unrelated jobs
 * may run concurrently; only the same job name is serialized.
 */

import type { Pool, PoolClient } from 'pg';

/**
 * Job lock handle. Holds the dedicated session that owns the advisory lock.
 * The caller MUST call release() in a finally block to clean up properly.
 */
export interface JobLock {
  /** The dedicated client holding the lock (do not use for other queries). */
  readonly client: PoolClient;
  /** Job name this lock protects. */
  readonly jobName: string;
  /** Release the advisory lock and return the client to the pool. */
  release(): Promise<void>;
}

/**
 * Job lock namespace. Advisory lock keys are 64-bit integers; we use the high
 * 32 bits as a namespace to avoid collisions with other advisory lock uses.
 */
const JOB_LOCK_NAMESPACE = 0x564a4f42; // 'VJOB' in hex

/**
 * Try to acquire a session advisory lock for the given job name. Returns
 * immediately (non-blocking). If acquired, returns a JobLock handle that holds
 * a dedicated PoolClient for the lock lifetime. The caller MUST call
 * lock.release() in a finally block.
 *
 * Advisory locks are session-scoped: they survive COMMIT/ROLLBACK and are
 * released when the session ends (connection closed or returned to pool). A
 * crashed job releases its lock automatically when the connection dies.
 *
 * @param pool - Connection pool to acquire a dedicated client from.
 * @param jobName - Unique job identifier (e.g., 'ingest', 'enrich').
 * @returns JobLock if acquired, null if already held by another session.
 */
export async function tryAcquireJobLock(
  pool: Pool,
  jobName: string,
): Promise<JobLock | null> {
  const lockKey = jobNameToLockKey(jobName);

  // Acquire a dedicated client for the lock lifetime.
  const client = await pool.connect();

  try {
    // pg_try_advisory_lock returns true if acquired, false if already held.
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1, $2) AS acquired',
      [JOB_LOCK_NAMESPACE, lockKey],
    );

    const acquired = result.rows[0]?.acquired ?? false;

    if (acquired) {
      // Lock acquired successfully; return handle with release method.
      return {
        client,
        jobName,
        async release() {
          try {
            // Release the advisory lock on the same session.
            await client.query('SELECT pg_advisory_unlock($1, $2)', [
              JOB_LOCK_NAMESPACE,
              lockKey,
            ]);
          } finally {
            // Always return the client to the pool, even if unlock fails.
            client.release();
          }
        },
      };
    } else {
      // Lock not acquired; release the client immediately.
      client.release();
      return null;
    }
  } catch (error) {
    // Error during lock acquisition; release the client.
    client.release();
    throw error;
  }
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
