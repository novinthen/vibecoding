/**
 * Stage 9A — Pipeline integration tests (DB-gated).
 *
 * Tests that pipeline stages use correct per-stage locks and create independent job_runs.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';

import { runJob } from '@/jobs/job-runner';
import { runIngestionJob } from '@/jobs/ingestion-job';
import { runPipelineJob, runPipelineWithLock } from '@/jobs/pipeline-job';
import { tryAcquireJobLock } from '@/jobs/locking';
import { buildJobResult } from '@/jobs/job-runner';
import type { JobOutcome } from '@/jobs/types';

const skipIfNoDb = !process.env.DATABASE_URL;

describe.skipIf(skipIfNoDb)('Pipeline integration (DB-gated)', () => {
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
      "DELETE FROM job_runs WHERE job_name LIKE 'test-%' OR job_name IN ('pipeline', 'ingest', 'enrich', 'cluster', 'rank')",
    );
  });

  it('creates independent job_runs for the parent and every pipeline stage', async () => {
    // Use the production entry point: it takes the pipeline-level lock AND
    // records the parent `pipeline` job_run. Calling runPipelineJob directly
    // would record only the child stages.
    const outcome = await runPipelineWithLock(pool, {
      ingestion: { batchLimit: 0 }, // Process 0 sources (fast, no network)
      enrichment: { batchLimit: 0 },
      clustering: { batchLimit: 0 },
      ranking: { batchLimit: 0 },
    });

    // No locks held and no items to process → the whole pipeline must succeed.
    expect(outcome.result.status).toBe('SUCCEEDED');

    const allRuns = await pool.query<{ job_name: string; status: string }>(
      "SELECT job_name, status FROM job_runs WHERE job_name IN ('pipeline', 'ingest', 'enrich', 'cluster', 'rank') ORDER BY started_at ASC",
    );

    // Exactly one parent + one row per stage. No weaker assertion: with no
    // contention every stage must run.
    expect(allRuns.rows.length).toBe(5);
    expect(allRuns.rows.map((r) => r.job_name)).toEqual([
      'pipeline',
      'ingest',
      'enrich',
      'cluster',
      'rank',
    ]);
    expect(allRuns.rows.every((r) => r.status === 'SUCCEEDED')).toBe(true);
  });

  it('standalone ingest is refused while the ingest stage lock is held', async () => {
    // Hold the ingest lock on a REAL separate session, exactly as a running
    // pipeline ingest stage would. This asserts the mutual-exclusion invariant
    // deterministically instead of racing a fast in-process stage.
    const heldLock = await tryAcquireJobLock(pool, 'ingest');
    expect(heldLock).not.toBeNull();

    try {
      const standaloneOutcome = await runJob(
        'ingest',
        async (p) => runIngestionJob(p, { batchLimit: 0 }),
        { pool },
      );

      // Standalone must be refused, not run concurrently.
      expect(standaloneOutcome.result.status).toBe('SKIPPED');
      expect(
        (standaloneOutcome.result.metadata as Record<string, unknown> | null)
          ?.reason,
      ).toBe('lock_held');
    } finally {
      await heldLock!.release();
    }

    // After release the same job proceeds normally.
    const afterRelease = await runJob(
      'ingest',
      async (p) => runIngestionJob(p, { batchLimit: 0 }),
      { pool },
    );
    expect(afterRelease.result.status).toBe('SUCCEEDED');
  });

  it('pipeline stage SKIPPED is reflected correctly', async () => {
    // Hold ingest lock manually
    const lockJob = runJob(
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

    // Small delay to ensure lock is held
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Run pipeline - ingest stage should be skipped
    const pipelineOutcome = await runPipelineJob(pool, {
      ingestion: { batchLimit: 0 },
      enrichment: { batchLimit: 0 },
      clustering: { batchLimit: 0 },
      ranking: { batchLimit: 0 },
    });

    // Pipeline should report the skip
    const metadata = pipelineOutcome.result.metadata as Record<
      string,
      unknown
    > | null;
    expect(metadata).toBeDefined();

    interface StageResult {
      stage: string;
      status: string;
    }

    const stageResults = metadata?.stageResults as StageResult[] | undefined;
    expect(stageResults).toBeDefined();

    const ingestStage = stageResults?.find((s) => s.stage === 'ingestion');
    expect(ingestStage?.status).toBe('SKIPPED');

    await lockJob;
  });
});
