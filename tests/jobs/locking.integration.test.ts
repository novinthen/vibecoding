/**
 * Stage 9A — Job locking integration tests (DB-gated).
 *
 * Tests the session-correct advisory lock implementation against real PostgreSQL.
 * These tests verify that locks are truly session-scoped and prevent overlaps.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

import { tryAcquireJobLock } from '@/jobs/locking';

// Skip if DATABASE_URL is not configured
const skipIfNoDb = !process.env.DATABASE_URL;

describe.skipIf(skipIfNoDb)('Job locking integration (DB-gated)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('acquires a lock successfully', async () => {
    const lock = await tryAcquireJobLock(pool, 'test-job-1');
    expect(lock).not.toBeNull();
    await lock!.release();
  });

  it('prevents overlapping runs of the same job', async () => {
    const lock1 = await tryAcquireJobLock(pool, 'test-job-2');
    expect(lock1).not.toBeNull();

    // Second attempt on same job should fail
    const lock2 = await tryAcquireJobLock(pool, 'test-job-2');
    expect(lock2).toBeNull();

    // Release first lock
    await lock1!.release();

    // Now can acquire again
    const lock3 = await tryAcquireJobLock(pool, 'test-job-2');
    expect(lock3).not.toBeNull();
    await lock3!.release();
  });

  it('allows different jobs to run concurrently', async () => {
    const lock1 = await tryAcquireJobLock(pool, 'test-job-3a');
    const lock2 = await tryAcquireJobLock(pool, 'test-job-3b');
    const lock3 = await tryAcquireJobLock(pool, 'test-job-3c');

    expect(lock1).not.toBeNull();
    expect(lock2).not.toBeNull();
    expect(lock3).not.toBeNull();

    await lock1!.release();
    await lock2!.release();
    await lock3!.release();
  });

  it('releases lock after thrown error', async () => {
    const lock = await tryAcquireJobLock(pool, 'test-job-4');
    expect(lock).not.toBeNull();

    // Simulate error and cleanup
    try {
      throw new Error('Test error');
    } finally {
      await lock!.release();
    }

    // Lock should now be available
    const lock2 = await tryAcquireJobLock(pool, 'test-job-4');
    expect(lock2).not.toBeNull();
    await lock2!.release();
  });

  it('subsequent run succeeds after release', async () => {
    // First run
    const lock1 = await tryAcquireJobLock(pool, 'test-job-5');
    expect(lock1).not.toBeNull();
    await lock1!.release();

    // Second run
    const lock2 = await tryAcquireJobLock(pool, 'test-job-5');
    expect(lock2).not.toBeNull();
    await lock2!.release();

    // Third run
    const lock3 = await tryAcquireJobLock(pool, 'test-job-5');
    expect(lock3).not.toBeNull();
    await lock3!.release();
  });

  it('uses dedicated session (same client for acquire and release)', async () => {
    const lock = await tryAcquireJobLock(pool, 'test-job-6');
    expect(lock).not.toBeNull();

    // The lock.client should be the same client used for both acquire and release
    expect(lock!.client).toBeDefined();

    // Another attempt should fail (lock is held)
    const lock2 = await tryAcquireJobLock(pool, 'test-job-6');
    expect(lock2).toBeNull();

    // Release using the dedicated client
    await lock!.release();

    // Now should be available
    const lock3 = await tryAcquireJobLock(pool, 'test-job-6');
    expect(lock3).not.toBeNull();
    await lock3!.release();
  });
});
