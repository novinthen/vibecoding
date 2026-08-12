import { NextResponse } from 'next/server';

import { resolveCronSecret } from '@/config/env';
import { getPool } from '@/db/client';
import {
  isAuthorizedTrigger,
  isTriggerableJob,
  runTriggerableJob,
  triggerHttpStatus,
} from '@/jobs/http-trigger';

/**
 * Production job-trigger endpoint (Stage 10).
 *
 * The smallest safe way to invoke the EXISTING Stage 9A job orchestration from a
 * deployment scheduler. It is:
 *  - authenticated: `Authorization: Bearer <CRON_SECRET>`, constant-time checked;
 *    unset secret ⇒ fails closed (every request 401);
 *  - bounded: only the allowlisted jobs run, each with its own advisory lock, so
 *    overlap protection stays the job runner's responsibility (no new pipeline);
 *  - observable: every run persists a `job_runs` row exactly as the CLI does.
 *
 * Both POST (semantically correct for external schedulers/GitHub Actions) and GET
 * (Vercel Cron only issues GET) are accepted and share one handler. Runs on the
 * Node.js runtime because it uses the `pg` pool; never statically cached.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(
  request: Request,
  ctx: { params: Promise<{ job: string }> },
): Promise<NextResponse> {
  // Authenticate first; never reveal whether the job name is valid to an
  // unauthenticated caller.
  if (
    !isAuthorizedTrigger(
      request.headers.get('authorization'),
      resolveCronSecret(),
    )
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { job } = await ctx.params;
  if (!isTriggerableJob(job)) {
    return NextResponse.json({ error: 'Unknown job' }, { status: 404 });
  }

  const outcome = await runTriggerableJob(job, getPool());
  // Return the operational summary only (no secrets, no internals).
  return NextResponse.json(
    {
      job,
      kind: outcome.kind,
      status: outcome.result.status,
      attempted: outcome.result.attempted,
      succeeded: outcome.result.succeeded,
      skipped: outcome.result.skipped,
      failed: outcome.result.failed,
      durationMs: outcome.result.durationMs,
    },
    { status: triggerHttpStatus(outcome) },
  );
}

export function POST(
  request: Request,
  ctx: { params: Promise<{ job: string }> },
): Promise<NextResponse> {
  return handle(request, ctx);
}

export function GET(
  request: Request,
  ctx: { params: Promise<{ job: string }> },
): Promise<NextResponse> {
  return handle(request, ctx);
}
