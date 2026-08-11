import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { JobRunRepository } from '@/jobs/job-run-repository';
import { getPool } from '@/db/client';

describe('JobRunRepository', () => {
  let repo: JobRunRepository;

  beforeEach(async () => {
    const pool = getPool();
    repo = new JobRunRepository(pool);
  });

  afterEach(async () => {
    // Cleanup job_runs table
    const pool = getPool();
    await pool.query('DELETE FROM job_runs');
  });

  describe('createJobRun', () => {
    it('creates a job run with RUNNING status', async () => {
      const startedAt = new Date('2026-08-11T10:00:00Z');
      const row = await repo.createJobRun({
        jobName: 'ingest',
        startedAt,
      });

      expect(row.job_name).toBe('ingest');
      expect(row.status).toBe('RUNNING');
      expect(new Date(row.started_at)).toEqual(startedAt);
      expect(row.finished_at).toBeNull();
      expect(row.attempted).toBe(0);
      expect(row.succeeded).toBe(0);
      expect(row.failed).toBe(0);
    });
  });

  describe('completeJobRun', () => {
    it('updates a running job with final outcome', async () => {
      const startedAt = new Date('2026-08-11T10:00:00Z');
      const finishedAt = new Date('2026-08-11T10:05:00Z');

      const created = await repo.createJobRun({ jobName: 'ingest', startedAt });

      const completed = await repo.completeJobRun(created.id, {
        status: 'SUCCEEDED',
        finishedAt,
        durationMs: 300000,
        attempted: 10,
        succeeded: 10,
        skipped: 0,
        failed: 0,
        retryableFailures: 0,
        errorSummary: null,
        metadata: { batchLimit: 100 },
      });

      expect(completed.status).toBe('SUCCEEDED');
      expect(new Date(completed.finished_at!)).toEqual(finishedAt);
      expect(completed.duration_ms).toBe(300000);
      expect(completed.attempted).toBe(10);
      expect(completed.succeeded).toBe(10);
      expect(completed.failed).toBe(0);
      expect(completed.metadata).toEqual({ batchLimit: 100 });
    });

    it('records partial failures', async () => {
      const created = await repo.createJobRun({
        jobName: 'enrich',
        startedAt: new Date(),
      });

      const completed = await repo.completeJobRun(created.id, {
        status: 'PARTIAL',
        finishedAt: new Date(),
        durationMs: 60000,
        attempted: 10,
        succeeded: 7,
        skipped: 0,
        failed: 3,
        retryableFailures: 2,
        errorSummary: '3 Articles failed (2 retryable)',
        metadata: null,
      });

      expect(completed.status).toBe('PARTIAL');
      expect(completed.attempted).toBe(10);
      expect(completed.succeeded).toBe(7);
      expect(completed.failed).toBe(3);
      expect(completed.retryable_failures).toBe(2);
      expect(completed.error_summary).toBe('3 Articles failed (2 retryable)');
    });
  });

  describe('findLatestRun', () => {
    it('returns the most recent run for a job', async () => {
      await repo.createJobRun({
        jobName: 'ingest',
        startedAt: new Date('2026-08-11T09:00:00Z'),
      });
      const latest = await repo.createJobRun({
        jobName: 'ingest',
        startedAt: new Date('2026-08-11T10:00:00Z'),
      });

      const found = await repo.findLatestRun('ingest');
      expect(found?.id).toBe(latest.id);
    });

    it('returns null if no runs exist', async () => {
      const found = await repo.findLatestRun('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('findLastSuccessfulRun', () => {
    it('returns the most recent successful run', async () => {
      const run1 = await repo.createJobRun({
        jobName: 'cluster',
        startedAt: new Date('2026-08-11T08:00:00Z'),
      });
      await repo.completeJobRun(run1.id, {
        status: 'SUCCEEDED',
        finishedAt: new Date('2026-08-11T08:05:00Z'),
        durationMs: 300000,
        attempted: 5,
        succeeded: 5,
        skipped: 0,
        failed: 0,
        retryableFailures: 0,
        errorSummary: null,
        metadata: null,
      });

      const run2 = await repo.createJobRun({
        jobName: 'cluster',
        startedAt: new Date('2026-08-11T09:00:00Z'),
      });
      await repo.completeJobRun(run2.id, {
        status: 'FAILED',
        finishedAt: new Date('2026-08-11T09:01:00Z'),
        durationMs: 60000,
        attempted: 5,
        succeeded: 0,
        skipped: 0,
        failed: 5,
        retryableFailures: 0,
        errorSummary: 'All failed',
        metadata: null,
      });

      const found = await repo.findLastSuccessfulRun('cluster');
      expect(found?.id).toBe(run1.id);
      expect(found?.status).toBe('SUCCEEDED');
    });

    it('returns null if no successful runs exist', async () => {
      const run = await repo.createJobRun({
        jobName: 'rank',
        startedAt: new Date(),
      });
      await repo.completeJobRun(run.id, {
        status: 'FAILED',
        finishedAt: new Date(),
        durationMs: 1000,
        attempted: 1,
        succeeded: 0,
        skipped: 0,
        failed: 1,
        retryableFailures: 0,
        errorSummary: 'Failed',
        metadata: null,
      });

      const found = await repo.findLastSuccessfulRun('rank');
      expect(found).toBeNull();
    });
  });

  describe('findRunningJob', () => {
    it('returns a running job', async () => {
      const running = await repo.createJobRun({
        jobName: 'pipeline',
        startedAt: new Date(),
      });

      const found = await repo.findRunningJob('pipeline');
      expect(found?.id).toBe(running.id);
      expect(found?.status).toBe('RUNNING');
    });

    it('returns null if job is not running', async () => {
      const run = await repo.createJobRun({
        jobName: 'ingest',
        startedAt: new Date(),
      });
      await repo.completeJobRun(run.id, {
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        durationMs: 1000,
        attempted: 1,
        succeeded: 1,
        skipped: 0,
        failed: 0,
        retryableFailures: 0,
        errorSummary: null,
        metadata: null,
      });

      const found = await repo.findRunningJob('ingest');
      expect(found).toBeNull();
    });
  });

  describe('listRecentRuns', () => {
    it('lists recent runs across all jobs', async () => {
      await repo.createJobRun({ jobName: 'ingest', startedAt: new Date() });
      await repo.createJobRun({ jobName: 'enrich', startedAt: new Date() });
      await repo.createJobRun({ jobName: 'cluster', startedAt: new Date() });

      const runs = await repo.listRecentRuns(10);
      expect(runs.length).toBe(3);
      expect(runs[0]!.started_at >= runs[1]!.started_at).toBe(true);
    });

    it('respects limit', async () => {
      for (let i = 0; i < 10; i++) {
        await repo.createJobRun({ jobName: 'test', startedAt: new Date() });
      }

      const runs = await repo.listRecentRuns(5);
      expect(runs.length).toBe(5);
    });
  });

  describe('listRunsForJob', () => {
    it('lists runs for a specific job', async () => {
      await repo.createJobRun({ jobName: 'ingest', startedAt: new Date() });
      await repo.createJobRun({ jobName: 'ingest', startedAt: new Date() });
      await repo.createJobRun({ jobName: 'enrich', startedAt: new Date() });

      const runs = await repo.listRunsForJob('ingest', 10);
      expect(runs.length).toBe(2);
      expect(runs.every((r) => r.job_name === 'ingest')).toBe(true);
    });
  });
});
