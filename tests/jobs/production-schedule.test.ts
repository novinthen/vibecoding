import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Stage 10 — production scheduling guard.
 *
 * The HTTP job-trigger route runs as a serverless function bounded by
 * `maxDuration`, and that limit applies to every invocation. The full `pipeline`
 * job contains sequential network/AI work whose cumulative worst case cannot be
 * proven to fit a short (60 s) function budget, so this repository deliberately
 * ships NO automatic Vercel Cron schedule for it — the pipeline is run via the
 * CLI on a long-lived runner, or over HTTP only on a runtime proven to fit (see
 * docs/OPERATIONS.md).
 *
 * This test encodes that decision so it cannot silently regress: if a `vercel.json`
 * is (re-)introduced, it must not auto-schedule the trigger route for the full
 * pipeline (or any job) against an unproven function budget.
 */
describe('production scheduling policy', () => {
  const vercelJsonPath = join(process.cwd(), 'vercel.json');

  it('does not ship an automatic Vercel Cron schedule for the job-trigger route', () => {
    if (!existsSync(vercelJsonPath)) {
      // No Vercel scheduling shipped — the safe, documented default.
      expect(existsSync(vercelJsonPath)).toBe(false);
      return;
    }
    const config = JSON.parse(readFileSync(vercelJsonPath, 'utf8')) as {
      crons?: Array<{ path?: string }>;
    };
    const jobCrons = (config.crons ?? []).filter((c) =>
      (c.path ?? '').startsWith('/api/jobs/'),
    );
    // If someone adds Vercel Cron for the job trigger, it must be a deliberate,
    // reviewed change accompanied by a proven runtime budget — not the default.
    expect(
      jobCrons,
      'vercel.json must not auto-schedule /api/jobs/* on an unproven function budget; ' +
        'run the pipeline via CLI or an HTTP runtime proven to fit (see docs/OPERATIONS.md)',
    ).toEqual([]);
  });
});
