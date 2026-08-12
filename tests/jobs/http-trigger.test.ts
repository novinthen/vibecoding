import { describe, expect, it } from 'vitest';

import { resolveCronSecret } from '@/config/env';
import type { AppEnv } from '@/config/env';
import {
  CRON_PIPELINE_OPTIONS,
  isAuthorizedTrigger,
  isTriggerableJob,
  runTriggerableJob,
  triggerHttpStatus,
  TRIGGERABLE_JOBS,
} from '@/jobs/http-trigger';
import type { JobOutcome, JobResult, JobStatus } from '@/jobs/types';

import { GET, POST } from '../../src/app/api/jobs/[job]/route';

/**
 * Stage 10 — production job-trigger security tests.
 *
 * The endpoint's security correctness lives in two pure helpers (a constant-time
 * bearer check and a job-name allowlist); both are covered exhaustively here. The
 * route-level tests assert the fail-closed behaviour: with no CRON_SECRET
 * configured in the test environment, EVERY request is rejected with 401 before
 * any job runs or database access occurs.
 */

describe('isAuthorizedTrigger', () => {
  const secret = 's3cr3t-value-1234567890';

  it('accepts an exact Bearer match', () => {
    expect(isAuthorizedTrigger(`Bearer ${secret}`, secret)).toBe(true);
  });

  it('rejects a wrong secret', () => {
    expect(isAuthorizedTrigger('Bearer wrong', secret)).toBe(false);
  });

  it('rejects a value missing the Bearer scheme', () => {
    expect(isAuthorizedTrigger(secret, secret)).toBe(false);
  });

  it('fails closed when the configured secret is unset', () => {
    expect(isAuthorizedTrigger(`Bearer ${secret}`, null)).toBe(false);
    expect(isAuthorizedTrigger(`Bearer ${secret}`, '')).toBe(false);
  });

  it('rejects a missing/empty Authorization header', () => {
    expect(isAuthorizedTrigger(null, secret)).toBe(false);
    expect(isAuthorizedTrigger(undefined, secret)).toBe(false);
    expect(isAuthorizedTrigger('', secret)).toBe(false);
  });

  it('rejects a header that only shares a prefix (length-safe)', () => {
    expect(isAuthorizedTrigger(`Bearer ${secret}extra`, secret)).toBe(false);
    expect(isAuthorizedTrigger(`Bearer ${secret.slice(0, -1)}`, secret)).toBe(
      false,
    );
  });
});

describe('isTriggerableJob', () => {
  it('accepts exactly the allowlisted jobs', () => {
    for (const job of TRIGGERABLE_JOBS) {
      expect(isTriggerableJob(job)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    for (const bad of [
      '',
      'INGEST',
      'delete',
      'jobs',
      'pipeline ',
      '../rank',
    ]) {
      expect(isTriggerableJob(bad)).toBe(false);
    }
  });
});

describe('triggerHttpStatus', () => {
  // Build an outcome with a given terminal status and (independently) kind, so we
  // can prove the mapping keys off result.status and NOT kind.
  function outcome(status: JobStatus, kind: JobOutcome['kind']): JobOutcome {
    const result = { status } as unknown as JobResult;
    if (kind === 'FAILED') return { kind, result, reason: 'x' };
    return { kind, result } as JobOutcome;
  }

  it('maps SUCCEEDED and PARTIAL to 200', () => {
    expect(triggerHttpStatus(outcome('SUCCEEDED', 'SUCCESS'))).toBe(200);
    expect(triggerHttpStatus(outcome('PARTIAL', 'PARTIAL'))).toBe(200);
  });

  it('maps a lock-held SKIPPED (kind FAILED, status SKIPPED) to 200, not 500', () => {
    // This is exactly what runJob returns on advisory-lock contention.
    expect(triggerHttpStatus(outcome('SKIPPED', 'FAILED'))).toBe(200);
  });

  it('maps a genuine FAILED status to 500', () => {
    expect(triggerHttpStatus(outcome('FAILED', 'FAILED'))).toBe(500);
  });
});

describe('runTriggerableJob — bounded cron pipeline', () => {
  it('exposes conservative, bounded cron pipeline batches', () => {
    expect(CRON_PIPELINE_OPTIONS.ingestion?.batchLimit).toBeLessThanOrEqual(10);
    // Enrichment (network AI) is the slowest stage → smallest batch.
    expect(CRON_PIPELINE_OPTIONS.enrichment?.batchLimit).toBeLessThanOrEqual(5);
    expect(CRON_PIPELINE_OPTIONS.clustering?.batchLimit).toBeLessThanOrEqual(
      50,
    );
    expect(CRON_PIPELINE_OPTIONS.ranking?.batchLimit).toBeLessThanOrEqual(50);
    // Every stage is explicitly bounded (never left to Stage 9A's large defaults).
    for (const stage of [
      CRON_PIPELINE_OPTIONS.ingestion,
      CRON_PIPELINE_OPTIONS.enrichment,
      CRON_PIPELINE_OPTIONS.clustering,
      CRON_PIPELINE_OPTIONS.ranking,
    ]) {
      expect(typeof stage?.batchLimit).toBe('number');
    }
  });

  it('forwards the bounded cron options to the pipeline runner (not defaults)', async () => {
    let received: unknown;
    const fakeOutcome = {
      kind: 'SUCCESS',
      result: { status: 'SUCCEEDED' },
    } as unknown as JobOutcome;
    const spy = (_pool: unknown, options?: unknown): Promise<JobOutcome> => {
      received = options;
      return Promise.resolve(fakeOutcome);
    };
    await runTriggerableJob('pipeline', {} as never, {
      pipeline: spy as never,
    });
    expect(received).toBe(CRON_PIPELINE_OPTIONS);
  });
});

describe('resolveCronSecret — production strength', () => {
  function envWith(overrides: Partial<AppEnv>): AppEnv {
    return {
      NODE_ENV: 'test',
      APP_ENV: 'local',
      NEXT_PUBLIC_APP_NAME: 'Test',
      ...overrides,
    } as AppEnv;
  }

  it('returns null when unset (fails closed)', () => {
    expect(resolveCronSecret(envWith({ CRON_SECRET: undefined }))).toBeNull();
  });

  it('allows a short secret outside production (test flexibility)', () => {
    const env = envWith({ NODE_ENV: 'test', CRON_SECRET: 'short' });
    expect(resolveCronSecret(env)).toBe('short');
  });

  it('rejects a short secret in production', () => {
    const env = envWith({ NODE_ENV: 'production', CRON_SECRET: 'too-short' });
    expect(() => resolveCronSecret(env)).toThrow(/at least 32 characters/i);
  });

  it('accepts a 32+ char secret in production', () => {
    const strong = 'x'.repeat(32);
    const env = envWith({ NODE_ENV: 'production', CRON_SECRET: strong });
    expect(resolveCronSecret(env)).toBe(strong);
  });
});

describe('POST/GET /api/jobs/[job] — fail closed without CRON_SECRET', () => {
  function req(auth?: string): Request {
    return new Request('http://localhost/api/jobs/ingest', {
      method: 'POST',
      headers: auth ? { authorization: auth } : {},
    });
  }
  const params = Promise.resolve({ job: 'ingest' });

  it('rejects an unauthenticated POST with 401 (no job runs)', async () => {
    const res = await POST(req(), { params });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('rejects even a Bearer request with 401 when no secret is configured', async () => {
    const res = await POST(req('Bearer anything'), { params });
    expect(res.status).toBe(401);
  });

  it('rejects an unauthenticated GET with 401', async () => {
    const res = await GET(req(), { params });
    expect(res.status).toBe(401);
  });
});
