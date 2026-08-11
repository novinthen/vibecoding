import { describe, it, expect } from 'vitest';

import { tryAcquireJobLock, releaseJobLock } from '@/jobs/locking';
import { getPool } from '@/db/client';

describe('Job locking (advisory locks)', () => {
  it('acquires a lock for a new job', async () => {
    const pool = getPool();
    const result = await tryAcquireJobLock(pool, 'test-job');
    expect(result.acquired).toBe(true);
    await releaseJobLock(pool, 'test-job');
  });

  it('prevents overlapping runs of the same job', async () => {
    const pool = getPool();

    // First lock acquisition
    const result1 = await tryAcquireJobLock(pool, 'ingest');
    expect(result1.acquired).toBe(true);

    // Second attempt on same job should fail
    const result2 = await tryAcquireJobLock(pool, 'ingest');
    expect(result2.acquired).toBe(false);

    // Release and try again
    await releaseJobLock(pool, 'ingest');
    const result3 = await tryAcquireJobLock(pool, 'ingest');
    expect(result3.acquired).toBe(true);
    await releaseJobLock(pool, 'ingest');
  });

  it('allows different jobs to run concurrently', async () => {
    const pool = getPool();

    const result1 = await tryAcquireJobLock(pool, 'ingest');
    expect(result1.acquired).toBe(true);

    const result2 = await tryAcquireJobLock(pool, 'enrich');
    expect(result2.acquired).toBe(true);

    const result3 = await tryAcquireJobLock(pool, 'cluster');
    expect(result3.acquired).toBe(true);

    await releaseJobLock(pool, 'ingest');
    await releaseJobLock(pool, 'enrich');
    await releaseJobLock(pool, 'cluster');
  });

  it('generates stable lock keys from job names', async () => {
    const pool = getPool();

    // Same job name should always map to same lock
    const result1 = await tryAcquireJobLock(pool, 'stable-job');
    expect(result1.acquired).toBe(true);

    // Second attempt with identical name should fail
    const result2 = await tryAcquireJobLock(pool, 'stable-job');
    expect(result2.acquired).toBe(false);

    await releaseJobLock(pool, 'stable-job');

    // After release, can acquire again
    const result3 = await tryAcquireJobLock(pool, 'stable-job');
    expect(result3.acquired).toBe(true);
    await releaseJobLock(pool, 'stable-job');
  });
});
