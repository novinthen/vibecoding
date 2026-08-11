/**
 * Stage 9A — Job runner integration tests (DB-gated).
 *
 * Tests job orchestration, persistence, and lock lifecycle against real PostgreSQL.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';

import { runJob, buildJobResult } from '@/jobs/job-runner';
import { JobRunRepository } from '@/jobs/job-run-repository';
import type { JobOutcome } from '@/jobs/types';

// Skip if DATABASE_URL is not configured
const skipIfNoDb = !process.env.DATABASE_URL;

describe.skipIf(skipIfNoDb)('Job runner integration (DB-gated)', () => {
  let pool: Pool;
  let repo: JobRunRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    repo = new JobRunRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Clean up test job runs
    await pool.query("DELETE FROM job_runs WHERE job_name LIKE 'test-%'");
  });

  it('persists job run on success', async () => {
    const outcome = await runJob(
      'test-success',
      async () => {
        return {
          kind: 'SUCCESS',
          result: buildJobResult(
            'test-success',
            new Date(),
            new Date(),
            {
              attempted: 10,
              succeeded: 10,
              skipped: 0,
              failed: 0,
              retryableFailures: 0,
            },
            null,
            null,
          ),
        } as JobOutcome;
      },
      { pool },
    );

    expect(outcome.kind).toBe('SUCCESS');
    expect(outcome.result.status).toBe('SUCCEEDED');

    const runs = await repo.listRunsForJob('test-success', 10);
    expect(runs.length).toBe(1);
    expect(runs[0]!.status).toBe('SUCCEEDED');
    expect(runs[0]!.attempted).toBe(10);
    expect(runs[0]!.succeeded).toBe(10);
  });

  it('persists SKIPPED job run on overlap', async () => {
    // Start first job (doesn't finish immediately)
    const outcome1Promise = runJob(
      'test-overlap',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return {
          kind: 'SUCCESS',
          result: buildJobResult(
            'test-overlap',
            new Date(),
            new Date(),
            {
              attempted: 5,
              succeeded: 5,
              skipped: 0,
              failed: 0,
              retryableFailures: 0,
            },
            null,
            null,
          ),
        } as JobOutcome;
      },
      { pool },
    );

    // Second attempt should be skipped
    const outcome2 = await runJob(
      'test-overlap',
      async () => {
        throw new Error('Should not execute');
      },
      { pool },
    );

    expect(outcome2.result.status).toBe('SKIPPED');
    expect(outcome2.result.errorSummary).toContain('already running');

    // Wait for first job to complete
    await outcome1Promise;

    // Check that both runs were persisted
    const runs = await repo.listRunsForJob('test-overlap', 10);
    expect(runs.length).toBe(2);
    expect(runs.some((r) => r.status === 'SKIPPED')).toBe(true);
    expect(runs.some((r) => r.status === 'SUCCEEDED')).toBe(true);
  });

  it('releases lock after job completion', async () => {
    // First run
    await runJob(
      'test-release',
      async () => {
        return {
          kind: 'SUCCESS',
          result: buildJobResult(
            'test-release',
            new Date(),
            new Date(),
            {
              attempted: 1,
              succeeded: 1,
              skipped: 0,
              failed: 0,
              retryableFailures: 0,
            },
            null,
            null,
          ),
        } as JobOutcome;
      },
      { pool },
    );

    // Second run should succeed (lock was released)
    const outcome2 = await runJob(
      'test-release',
      async () => {
        return {
          kind: 'SUCCESS',
          result: buildJobResult(
            'test-release',
            new Date(),
            new Date(),
            {
              attempted: 1,
              succeeded: 1,
              skipped: 0,
              failed: 0,
              retryableFailures: 0,
            },
            null,
            null,
          ),
        } as JobOutcome;
      },
      { pool },
    );

    expect(outcome2.kind).toBe('SUCCESS');

    const runs = await repo.listRunsForJob('test-release', 10);
    expect(runs.length).toBe(2);
    expect(runs.every((r) => r.status === 'SUCCEEDED')).toBe(true);
  });

  it('releases lock after thrown error', async () => {
    // First run throws error
    await runJob(
      'test-error-release',
      async () => {
        throw new Error('Test error');
      },
      { pool },
    ).catch(() => {
      // Expected to throw
    });

    // Second run should succeed (lock was released in finally)
    const outcome2 = await runJob(
      'test-error-release',
      async () => {
        return {
          kind: 'SUCCESS',
          result: buildJobResult(
            'test-error-release',
            new Date(),
            new Date(),
            {
              attempted: 1,
              succeeded: 1,
              skipped: 0,
              failed: 0,
              retryableFailures: 0,
            },
            null,
            null,
          ),
        } as JobOutcome;
      },
      { pool },
    );

    expect(outcome2.kind).toBe('SUCCESS');
  });
});
