import { describe, it, expect } from 'vitest';

import { buildJobResult } from '@/jobs/job-runner';

describe('buildJobResult', () => {
  it('derives SUCCEEDED status when no failures', () => {
    const result = buildJobResult(
      'ingest',
      new Date('2026-08-11T10:00:00Z'),
      new Date('2026-08-11T10:05:00Z'),
      {
        attempted: 10,
        succeeded: 10,
        skipped: 0,
        failed: 0,
        retryableFailures: 0,
      },
      null,
      null,
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(result.attempted).toBe(10);
    expect(result.succeeded).toBe(10);
    expect(result.failed).toBe(0);
    expect(result.durationMs).toBe(300000);
  });

  it('derives PARTIAL status when some items failed', () => {
    const result = buildJobResult(
      'enrich',
      new Date('2026-08-11T10:00:00Z'),
      new Date('2026-08-11T10:02:00Z'),
      {
        attempted: 10,
        succeeded: 7,
        skipped: 0,
        failed: 3,
        retryableFailures: 2,
      },
      '3 Articles failed (2 retryable)',
      { batchLimit: 100 },
    );

    expect(result.status).toBe('PARTIAL');
    expect(result.attempted).toBe(10);
    expect(result.succeeded).toBe(7);
    expect(result.failed).toBe(3);
    expect(result.retryableFailures).toBe(2);
    expect(result.errorSummary).toBe('3 Articles failed (2 retryable)');
    expect(result.metadata).toEqual({ batchLimit: 100 });
  });

  it('derives FAILED status when all items failed', () => {
    const result = buildJobResult(
      'cluster',
      new Date('2026-08-11T10:00:00Z'),
      new Date('2026-08-11T10:01:00Z'),
      {
        attempted: 5,
        succeeded: 0,
        skipped: 0,
        failed: 5,
        retryableFailures: 0,
      },
      'All Articles failed clustering',
      null,
    );

    expect(result.status).toBe('FAILED');
    expect(result.attempted).toBe(5);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(5);
    expect(result.errorSummary).toBe('All Articles failed clustering');
  });

  it('includes skipped count', () => {
    const result = buildJobResult(
      'ingest',
      new Date('2026-08-11T10:00:00Z'),
      new Date('2026-08-11T10:05:00Z'),
      {
        attempted: 10,
        succeeded: 8,
        skipped: 2,
        failed: 0,
        retryableFailures: 0,
      },
      null,
      { notModified: 2 },
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(result.skipped).toBe(2);
    expect(result.metadata).toEqual({ notModified: 2 });
  });

  it('calculates duration correctly', () => {
    const startedAt = new Date('2026-08-11T10:00:00Z');
    const finishedAt = new Date('2026-08-11T10:10:30Z');

    const result = buildJobResult(
      'pipeline',
      startedAt,
      finishedAt,
      {
        attempted: 100,
        succeeded: 95,
        skipped: 3,
        failed: 2,
        retryableFailures: 1,
      },
      '2 items failed',
      null,
    );

    expect(result.durationMs).toBe(630000); // 10 minutes 30 seconds
  });
});
