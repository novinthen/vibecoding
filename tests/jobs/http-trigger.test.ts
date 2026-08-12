import { describe, expect, it } from 'vitest';

import {
  isAuthorizedTrigger,
  isTriggerableJob,
  triggerHttpStatus,
  TRIGGERABLE_JOBS,
} from '@/jobs/http-trigger';
import type { JobOutcome } from '@/jobs/types';

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
  it('maps FAILED to 500 and everything else to 200', () => {
    const base = { result: { status: 'SUCCEEDED' } } as unknown as JobOutcome;
    expect(triggerHttpStatus({ ...base, kind: 'SUCCESS' } as JobOutcome)).toBe(
      200,
    );
    expect(triggerHttpStatus({ ...base, kind: 'PARTIAL' } as JobOutcome)).toBe(
      200,
    );
    expect(
      triggerHttpStatus({
        ...base,
        kind: 'FAILED',
        reason: 'x',
      } as JobOutcome),
    ).toBe(500);
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
