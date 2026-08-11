/**
 * Stage 9A — Pipeline correctness integration tests (DB-gated).
 *
 * Tests that pipeline STOPS when a required stage lock is held (dependency ordering).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';

import { runJob } from '@/jobs/job-runner';
import { runPipelineJob } from '@/jobs/pipeline-job';
import { buildJobResult } from '@/jobs/job-runner';
import type { JobOutcome } from '@/jobs/types';

const skipIfNoDb = !process.env.DATABASE_URL;

describe.skipIf(skipIfNoDb)('Pipeline correctness (DB-gated)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Clean up test job runs
    await pool.query(
      "DELETE FROM job_runs WHERE job_name IN ('pipeline', 'ingest', 'enrich', 'cluster', 'rank')",
    );
  });

  it('pipeline STOPS when ingest lock is held (first stage)', async () => {
    // Hold ingest lock
    const ingestLock = runJob(
      'ingest',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return {
          kind: 'SUCCESS',
          result: buildJobResult(
            'ingest',
            new Date(),
            new Date(),
            {
              attempted: 0,
              succeeded: 0,
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

    // Small delay to ensure lock is held
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Run pipeline - should stop after ingest SKIPPED
    const pipelineOutcome = await runPipelineJob(pool, {
      ingestion: { batchLimit: 0 },
      enrichment: { batchLimit: 0 },
      clustering: { batchLimit: 0 },
      ranking: { batchLimit: 0 },
    });

    // Pipeline must NOT be SUCCEEDED
    expect(pipelineOutcome.result.status).not.toBe('SUCCEEDED');

    // Check job_runs to verify downstream stages did NOT execute
    const runs = await pool.query<{ job_name: string; status: string }>(
      "SELECT job_name, status FROM job_runs WHERE job_name IN ('ingest', 'enrich', 'cluster', 'rank') ORDER BY started_at ASC",
    );

    // Should have: ingest (RUNNING from lock holder), ingest (SKIPPED from pipeline)
    // Should NOT have: enrich, cluster, rank
    const jobNames = runs.rows.map((r) => r.job_name);
    expect(jobNames.filter((n) => n === 'ingest').length).toBeGreaterThanOrEqual(
      1,
    );
    expect(jobNames.includes('enrich')).toBe(false);
    expect(jobNames.includes('cluster')).toBe(false);
    expect(jobNames.includes('rank')).toBe(false);

    // Check pipeline metadata identifies lock contention
    const metadata = pipelineOutcome.result.metadata as Record<
      string,
      unknown
    > | null;
    expect(metadata?.earlyStop).toBe(true);

    await ingestLock;
  });

  it('pipeline STOPS when enrich lock is held (middle stage)', async () => {
    // Hold enrichment lock
    const enrichLock = runJob(
      'enrich',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return {
          kind: 'SUCCESS',
          result: buildJobResult(
            'enrich',
            new Date(),
            new Date(),
            {
              attempted: 0,
              succeeded: 0,
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

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Run pipeline
    const pipelineOutcome = await runPipelineJob(pool, {
      ingestion: { batchLimit: 0 },
      enrichment: { batchLimit: 0 },
      clustering: { batchLimit: 0 },
      ranking: { batchLimit: 0 },
    });

    // Pipeline must NOT be SUCCEEDED
    expect(pipelineOutcome.result.status).not.toBe('SUCCEEDED');

    // Check that clustering and ranking did NOT execute
    const runs = await pool.query<{ job_name: string }>(
      "SELECT job_name FROM job_runs WHERE job_name IN ('cluster', 'rank')",
    );

    expect(runs.rows.length).toBe(0);

    // Check metadata
    const metadata = pipelineOutcome.result.metadata as Record<
      string,
      unknown
    > | null;
    expect(metadata?.earlyStop).toBe(true);

    await enrichLock;
  });

  it('pipeline succeeds when no locks are held', async () => {
    const outcome = await runPipelineJob(pool, {
      ingestion: { batchLimit: 0 },
      enrichment: { batchLimit: 0 },
      clustering: { batchLimit: 0 },
      ranking: { batchLimit: 0 },
    });

    // All stages should complete successfully (with 0 items)
    expect(outcome.result.status).toBe('SUCCEEDED');

    // Check all stage job_runs exist
    const runs = await pool.query<{ job_name: string; status: string }>(
      "SELECT job_name, status FROM job_runs WHERE job_name IN ('ingest', 'enrich', 'cluster', 'rank') ORDER BY started_at ASC",
    );

    expect(runs.rows.length).toBe(4);
    expect(runs.rows.every((r) => r.status === 'SUCCEEDED')).toBe(true);
  });

  it('after lock release, next pipeline succeeds', async () => {
    // First pipeline with held lock
    const lock = runJob(
      'ingest',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return {
          kind: 'SUCCESS',
          result: buildJobResult(
            'ingest',
            new Date(),
            new Date(),
            {
              attempted: 0,
              succeeded: 0,
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

    await new Promise((resolve) => setTimeout(resolve, 50));

    const outcome1 = await runPipelineJob(pool, {
      ingestion: { batchLimit: 0 },
      enrichment: { batchLimit: 0 },
      clustering: { batchLimit: 0 },
      ranking: { batchLimit: 0 },
    });

    expect(outcome1.result.status).not.toBe('SUCCEEDED');

    // Wait for lock to release
    await lock;

    // Clean up previous runs
    await pool.query("DELETE FROM job_runs WHERE job_name != 'test'");

    // Second pipeline should succeed
    const outcome2 = await runPipelineJob(pool, {
      ingestion: { batchLimit: 0 },
      enrichment: { batchLimit: 0 },
      clustering: { batchLimit: 0 },
      ranking: { batchLimit: 0 },
    });

    expect(outcome2.result.status).toBe('SUCCEEDED');
  });
});
