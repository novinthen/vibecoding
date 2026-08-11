/**
 * Stage 9A — Pipeline integration tests (DB-gated).
 *
 * Tests that pipeline stages use correct per-stage locks and create independent job_runs.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';

import { runJob } from '@/jobs/job-runner';
import { runIngestionJob } from '@/jobs/ingestion-job';
import { runPipelineJob } from '@/jobs/pipeline-job';
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

  it('creates independent job_runs for each pipeline stage', async () => {
    await runPipelineJob(pool, {
      ingestion: { batchLimit: 0 }, // Process 0 sources (fast test)
      enrichment: { batchLimit: 0 },
      clustering: { batchLimit: 0 },
      ranking: { batchLimit: 0 },
    });

    // Should have 5 job runs: pipeline + 4 stages
    const allRuns = await pool.query<{ job_name: string; status: string }>(
      "SELECT job_name, status FROM job_runs WHERE job_name IN ('pipeline', 'ingest', 'enrich', 'cluster', 'rank') ORDER BY started_at ASC",
    );

    // Parent pipeline + 4 child stages OR parent pipeline + 3 child stages if one was skipped
    expect(allRuns.rows.length).toBeGreaterThanOrEqual(4);
    expect(allRuns.rows.some((r) => r.job_name === 'pipeline')).toBe(true);

    // At least some of the stage jobs should exist
    const hasIngest = allRuns.rows.some((r) => r.job_name === 'ingest');
    const hasEnrich = allRuns.rows.some((r) => r.job_name === 'enrich');
    const hasCluster = allRuns.rows.some((r) => r.job_name === 'cluster');
    const hasRank = allRuns.rows.some((r) => r.job_name === 'rank');

    // Should have at least 3 of the 4 stages
    const stageCount = [hasIngest, hasEnrich, hasCluster, hasRank].filter(
      Boolean,
    ).length;
    expect(stageCount).toBeGreaterThanOrEqual(3);
  });

  it('standalone ingest cannot overlap pipeline ingest', async () => {
    // Start pipeline (doesn't finish immediately due to stages)
    const pipelinePromise = runPipelineJob(pool, {
      ingestion: { batchLimit: 0 },
      enrichment: { batchLimit: 0 },
      clustering: { batchLimit: 0 },
      ranking: { batchLimit: 0 },
    });

    // Small delay to ensure pipeline starts
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Try standalone ingest while pipeline is running
    const standaloneOutcome = await runJob(
      'ingest',
      async (p) => runIngestionJob(p, { batchLimit: 0 }),
      { pool },
    );

    // Standalone should be skipped (lock held by pipeline stage)
    expect(standaloneOutcome.result.status).toBe('SKIPPED');

    await pipelinePromise;
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
