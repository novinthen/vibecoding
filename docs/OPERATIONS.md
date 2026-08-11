# Stage 9A — Production Automation & Scheduling

## Overview

Stage 9A implements a bounded, safe, and repeatable job automation layer for the Vibe Coding News Portal. The system can now run the full intelligence pipeline (ingestion → enrichment → clustering → ranking) automatically without manual intervention, while maintaining editorial control and observability.

## Architecture

### Job Orchestration

All jobs follow a common lifecycle managed by `src/jobs/job-runner.ts`:

1. **Lock acquisition** — PostgreSQL advisory locks prevent overlapping runs of the same job
2. **Persistence** — Every run creates a `job_runs` row with status RUNNING
3. **Execution** — The job implementation processes a bounded batch
4. **Completion** — Final counts, duration, and errors are recorded
5. **Lock release** — Automatic cleanup (even on crash, since locks are session-scoped)

### Job Types

#### Ingestion Job (`jobs:ingest`)
- Processes enabled Sources with acceptable health (HEALTHY, DEGRADED, UNKNOWN by default)
- Respects batch limits (default: unbounded, but configurable)
- Isolates per-Source failures (one broken feed doesn't crash the batch)
- Reuses Stage 3 ingestion pipeline unchanged

#### Enrichment Job (`jobs:enrich`)
- Processes Articles without current AI enrichment
- Eligibility: not HIDDEN/DUPLICATE, has text, no current enrichment (unless forced)
- Batch limit: 100 Articles by default
- Reuses Stage 6 enrichment service unchanged
- Classifies failures as retryable (provider errors) or non-retryable (invalid output, ineligibility)

#### Clustering Job (`jobs:cluster`)
- Processes Articles not yet assigned to a Story
- Eligibility: not already clustered, has required text fields
- Batch limit: 50 Articles by default (clustering is more expensive)
- Reuses Stage 7 clustering engine unchanged
- Respects REVIEWED/LOCKED Story protection (never auto-modifies protected Stories)

#### Ranking Job (`jobs:rank`)
- Processes ACTIVE Stories needing ranking
- Skips Stories with recent rankings (< 1 hour) unless forced
- Batch limit: 100 Stories by default
- Reuses Stage 8 ranking engine unchanged
- No publishing side effects

#### Pipeline Job (`jobs:pipeline`)
- Orchestrates the full sequence: ingest → enrich → cluster → rank
- Each stage runs to completion before the next starts
- Individual item failures are isolated (partial success is recorded)
- Configurable policy: stop on partial failure or continue
- Returns combined outcome with per-stage results

### Job Locking

PostgreSQL advisory locks (`pg_try_advisory_lock`) prevent overlapping runs:

- **Session-scoped**: locks automatically release when the connection closes (no stale locks after crashes)
- **Non-blocking**: `tryAcquireJobLock` returns immediately (no deadlock risk)
- **Job-specific**: different jobs can run concurrently; only the same job name is serialized
- **Deterministic**: job names hash to stable 32-bit integers (namespace `0x564a4f42` avoids collisions)

### Job Persistence

The `job_runs` table (migration `0017`) stores structured summaries:

- `job_name`: identifier (ingest, enrich, cluster, rank, pipeline)
- `status`: RUNNING, SUCCEEDED, PARTIAL, FAILED
- `started_at`, `finished_at`, `duration_ms`: timing
- `attempted`, `succeeded`, `skipped`, `failed`, `retryable_failures`: counters
- `error_summary`: human-readable failure summary (first few errors + counts)
- `metadata`: structured context (batch limits, provider info, bounded failure details)

No unbounded logs are stored; failed items are summarized (first 10) in metadata.

### Operational Queries

`JobRunRepository` supports:

- **Currently running?** `findRunningJob(jobName)` — status RUNNING
- **Last successful run?** `findLastSuccessfulRun(jobName)` — most recent SUCCEEDED by `finished_at DESC`
- **Recent history?** `listRecentRuns(limit)` — last N runs across all jobs
- **Job-specific history?** `listRunsForJob(jobName, limit)` — last N runs for one job

Indexes support these queries efficiently without table scans.

## Running Jobs

### CLI Commands

All jobs are runnable via npm scripts:

```bash
npm run jobs:ingest    # Ingest enabled Sources
npm run jobs:enrich    # Enrich eligible Articles
npm run jobs:cluster   # Cluster unclustered Articles
npm run jobs:rank      # Rank Stories needing ranking
npm run jobs:pipeline  # Run full pipeline
```

Each command:
- Acquires a job-specific lock (skips if already running)
- Persists run history to `job_runs`
- Prints outcome summary to stdout
- Exits with code 0 (success/partial) or 1 (failed)

### Manual Triggering

Jobs can also be triggered from admin UI (to be added) or called programmatically:

```typescript
import { runJob, runIngestionJob } from '@/jobs';

const outcome = await runJob('ingest', async (pool) => 
  runIngestionJob(pool, { batchLimit: 50 })
);
```

## Scheduling

### Recommended Cadences

Default examples (environment-configurable in production):

- **Ingestion**: every 5–15 minutes (depends on source update frequency)
- **Enrichment**: every 10–30 minutes (rate-limited by AI provider)
- **Clustering**: every 10–30 minutes (after enrichment has run)
- **Ranking**: every 10–30 minutes (after clustering has run)
- **Pipeline**: only if using single coordinated execution (longer interval)

### External Scheduler

Production scheduling options:

1. **Vercel Cron** (simplest for Vercel hosting):
   - Add API route at `/api/jobs/[job]`
   - Protect with secret token (constant-time comparison)
   - Configure schedule in `vercel.json`

2. **GitHub Actions** (repository-based):
   - Scheduled workflow calls authenticated API endpoint
   - Logs stored in Actions history

3. **System cron** (dedicated server):
   - `crontab -e` entries call `npm run jobs:*`
   - Output logged to file or syslog

4. **Inngest** (future enhancement):
   - Durable workflows with retries and observability
   - Currently not implemented (Stage 9A uses simpler scheduling)

### Avoiding the :00 and :30 Minute Marks

When user requests are approximate ("around 9am", "every hour"), pick off-peak minutes to distribute load:

- ❌ `0 9 * * *` — everyone hits the API at 9:00
- ✅ `7 9 * * *` or `53 8 * * *` — spread requests across minutes
- Only use :00 or :30 when explicitly required ("9:00 sharp")

## Retry Policy

### Retryable Failures

Transient errors that may succeed on the next run:

- Network timeouts (`FETCH_TIMEOUT`, `DNS_ERROR`)
- Provider rate limits (`RATE_LIMIT`)
- Server errors (`HTTP_5XX`, `PROVIDER_ERROR` with retryable classification)

Retryable failures are counted separately in `job_runs.retryable_failures`.

### Non-Retryable Failures

Persistent errors requiring manual intervention:

- Invalid Source configuration (`INVALID_URL`)
- Malformed AI output (`INVALID_OUTPUT`)
- Authorization errors
- Schema validation failures
- Article ineligibility (HIDDEN, DUPLICATE, no text)

Jobs record these but do not auto-retry.

### Retry Mechanism

Stage 9A does **not** implement autonomous retry loops. Retry is handled by:

1. **Re-running the job** (external scheduler calls the job again)
2. **Idempotency** (jobs skip already-processed items)
3. **Bounded batches** (each run processes a fresh batch of eligible items)

This keeps retry logic simple and observable. A broken Source/Article will be retried on the next scheduled run.

## Invariants

All jobs maintain these guarantees:

1. **Bounded execution** — no unbounded loops; all batches are size-limited
2. **Idempotent** — re-running a job is safe (skips already-current items)
3. **Isolated failures** — one bad item does not crash the entire batch
4. **No auto-publishing** — jobs enrich/cluster/rank but never publish Stories
5. **Article provenance preserved** — jobs never overwrite Article source facts
6. **Short transactions** — no DB locks held across network/AI calls
7. **Overlapping runs prevented** — advisory locks serialize same-job runs
8. **Observable** — every run persists outcome to `job_runs` (even failures)
9. **REVIEWED/LOCKED protection** — clustering never auto-modifies protected Stories
10. **Editorial override remains** — admin can still operate manually if automation is disabled

## Configuration

### Environment Variables

No new required variables for Stage 9A. Jobs use existing config:

- `DATABASE_URL` — required (PostgreSQL connection)
- `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` — optional (enrichment uses fake provider if unset)
- `EMBEDDING_PROVIDER` — optional (clustering uses fake provider by default)

### Job-Specific Options

Jobs accept runtime options (pass via programmatic API or extend CLI args):

```typescript
// Ingestion
runIngestionJob(pool, {
  batchLimit: 50,           // Max Sources per run
  minHealth: 'HEALTHY',     // Only process healthy Sources
  sourceIds: ['id1', 'id2'] // Explicit Source IDs (overrides filters)
});

// Enrichment
runEnrichmentJob(pool, {
  batchLimit: 100,          // Max Articles per run
  force: false,             // Re-enrich even if current enrichment exists
  articleIds: ['id1']       // Explicit Article IDs
});

// Clustering
runClusteringJob(pool, {
  batchLimit: 50,           // Max Articles per run
  force: false,             // Re-cluster already-clustered Articles
  articleIds: ['id1']       // Explicit Article IDs
});

// Ranking
runRankingJob(pool, {
  batchLimit: 100,          // Max Stories per run
  force: false,             // Re-rank even if recent ranking exists
  publicationId: 'pub1',    // Publication-specific ranking
  storyIds: ['id1']         // Explicit Story IDs
});

// Pipeline
runPipelineJob(pool, {
  stopOnPartial: false,     // Continue even if a stage has partial failures
  ingestion: { batchLimit: 50 },
  enrichment: { batchLimit: 100 },
  clustering: { batchLimit: 50 },
  ranking: { batchLimit: 100 }
});
```

## Testing

### Unit Tests

- **Locking** (`tests/jobs/locking.test.ts`): advisory lock acquisition, release, overlap prevention, concurrent different jobs
- **Job runner** (`tests/jobs/job-runner.test.ts`): `buildJobResult` status derivation (SUCCEEDED/PARTIAL/FAILED)
- **Repository** (`tests/jobs/job-run-repository.test.ts`): persistence, queries (latest, last successful, running)

### Integration Tests

(To be added after smoke test confirms basic functionality)

- End-to-end job runs with real database
- Batch limit enforcement
- Eligibility filtering
- Failure isolation
- Lock behavior under concurrent runs

## Deployment

### Migration

Run migration `0017` before deploying Stage 9A:

```bash
npm run db:migrate
```

Adds `job_runs` table with indexes for operational queries.

### Rollout Steps

1. Deploy application code with `/src/jobs` layer
2. Run migration to create `job_runs` table
3. Test jobs manually via CLI (`npm run jobs:ingest`, etc.)
4. Verify `job_runs` table populates correctly
5. Configure external scheduler (cron, Vercel Cron, GitHub Actions)
6. Monitor first scheduled runs
7. Adjust cadences based on source update frequency and API rate limits

### Rollback

If issues arise:

1. Disable scheduler (remove cron entries, disable Vercel Cron)
2. Jobs can still be run manually via CLI
3. Existing admin manual triggers (Sources, Articles, Stories) remain unchanged
4. `job_runs` table is append-only; no data loss on rollback

## Monitoring

### What to Watch

- **Stuck jobs**: `SELECT * FROM job_runs WHERE status = 'RUNNING' AND started_at < NOW() - INTERVAL '1 hour'`
- **Recent failures**: `SELECT * FROM job_runs WHERE status = 'FAILED' ORDER BY started_at DESC LIMIT 10`
- **Retryable failure rate**: `SELECT job_name, AVG(retryable_failures::float / NULLIF(failed, 0)) FROM job_runs GROUP BY job_name`
- **Job duration trends**: `SELECT job_name, percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FROM job_runs GROUP BY job_name`

### Admin Visibility

(To be added in follow-up work)

Admin dashboard sections:

- **Job Status Card**: currently running jobs, last successful run per job, recent failures
- **Job History Table**: recent runs (all jobs), sortable/filterable
- **Per-Job Detail View**: run history for one job, outcome charts, error summaries

Manual trigger buttons can reuse the same `runJob()` interface with proper authorization.

## Limitations & Future Work

### Not Implemented in Stage 9A

- **Admin UI for job runs** — visibility exists via SQL, not yet in admin dashboard
- **Authenticated HTTP job endpoints** — only CLI is implemented; API routes can be added
- **GitHub ingestion** — deferred to Stage 9 (Developer Intelligence)
- **Hacker News ingestion** — deferred to Stage 9
- **Inngest integration** — simpler scheduling model used; Inngest can replace external scheduler later
- **Auto-publishing** — remains editorial boundary (PublicationStory controlled manually)
- **Story auto-merging** — clustering creates/assigns but never merges Stories automatically
- **Retry backoff** — no exponential backoff; retries happen on next scheduled run
- **Alert notifications** — monitoring is manual SQL queries, no push notifications

### Future Enhancements

- Admin dashboard for job observability
- Authenticated internal HTTP endpoints for platform schedulers
- Prometheus/OpenTelemetry metrics export
- Cost tracking (AI provider spend per job run)
- Per-Source ingestion cadence (respect individual poll_interval)
- Dynamic batch sizing based on API rate limits
- Job run retention policy (auto-delete runs older than N days)

## Architecture Decisions

### Why Advisory Locks?

- Native PostgreSQL feature (no Redis dependency)
- Session-scoped (automatic cleanup on crash)
- Non-blocking (no deadlock risk)
- Sufficient for current scale (jobs run sequentially within job type)

Alternative considered: lease table with TTL. Rejected because:
- Requires background cleanup for stale leases
- More complex (timestamp comparisons, clock skew)
- Advisory locks solve the same problem with less code

### Why No Inngest Yet?

Inngest is approved architecture but not required for Stage 9A:
- External scheduler + CLI is simpler for initial automation
- No new runtime dependencies
- Inngest can be added later without changing job implementations

### Why Separate Jobs Instead of One Pipeline?

- Independent jobs are testable in isolation
- Operators can skip stages (e.g., only run ingestion if AI provider is unavailable)
- Failure of one stage doesn't prevent manual operation of others
- Pipeline job orchestrates when coordinated execution is desired

### Why Not Store Full Logs in PostgreSQL?

- Log volume grows unbounded (one entry per processed item)
- Full logs belong in structured logging system (stdout → log aggregator)
- `job_runs` stores structured *summaries* (first few failures, counts)
- Operators inspect full logs via log aggregation (not database queries)

## See Also

- **Stage 3** (News Ingestion Engine): `src/ingestion/ingest.ts`
- **Stage 6** (AI Intelligence): `src/ai/enrichment/service.ts`
- **Stage 7** (Story Clustering): `src/clustering/assignment.ts`
- **Stage 8** (Ranking & Trending): `src/ranking/ranking-engine.ts`
- **Data Model**: `docs/DATA_MODEL.md`
- **Architecture**: `docs/ARCHITECTURE.MD`
