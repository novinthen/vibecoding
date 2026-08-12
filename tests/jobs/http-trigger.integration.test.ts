import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { runTriggerableJob } from '@/jobs/http-trigger';
import { tryAcquireJobLock } from '@/jobs/locking';

/**
 * Stage 10 — production job-trigger dispatch (DB-gated).
 *
 * Proves the trigger dispatch runs through the EXISTING Stage 9A orchestration:
 * it records a `job_runs` row and honours the per-job advisory lock (overlap
 * protection is the job runner's responsibility, not the endpoint's). The
 * network-free `rank` job is used so the test is hermetic — on an empty ranking
 * set it simply succeeds with nothing to do.
 *
 * Skipped unless DATABASE_URL is set (mirrors the other job integration suites).
 */
const skipIfNoDb = !process.env.DATABASE_URL;

describe.skipIf(skipIfNoDb)('job-trigger dispatch (DB-gated)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM job_runs WHERE job_name = 'rank'");
  });

  it('runs the rank job via Stage 9A orchestration and records a job_run', async () => {
    const outcome = await runTriggerableJob('rank', pool);
    // Empty ranking set → nothing to do → success.
    expect(outcome.kind).toBe('SUCCESS');

    const runs = await pool.query<{ job_name: string; status: string }>(
      "SELECT job_name, status FROM job_runs WHERE job_name = 'rank'",
    );
    expect(runs.rows.length).toBe(1);
    expect(runs.rows[0]?.status).toBe('SUCCEEDED');
  });

  it('is refused (SKIPPED) while the rank lock is held on another session', async () => {
    // Hold the rank lock on a REAL separate session, as a concurrent run would.
    const lock = await tryAcquireJobLock(pool, 'rank');
    expect(lock).not.toBeNull();
    try {
      const outcome = await runTriggerableJob('rank', pool);
      // Overlap prevented by Stage 9A advisory lock; recorded as SKIPPED.
      expect(outcome.result.status).toBe('SKIPPED');
      const runs = await pool.query<{ status: string }>(
        "SELECT status FROM job_runs WHERE job_name = 'rank' ORDER BY started_at DESC",
      );
      expect(runs.rows.some((r) => r.status === 'SKIPPED')).toBe(true);
    } finally {
      await lock?.release();
    }
  });
});
