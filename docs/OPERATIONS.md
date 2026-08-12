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

The admin **`/admin/jobs`** page is intentionally read-only (it shows run history,
not trigger buttons). Besides the CLI and the authenticated `/api/jobs/[job]`
endpoint (Stage 10), jobs can be invoked programmatically:

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

### Production job-trigger endpoint (Stage 10)

The authenticated HTTP trigger is **implemented**:
`POST|GET /api/jobs/[job]` (`src/app/api/jobs/[job]/route.ts`). It is the smallest
safe way for a deployment scheduler to invoke the **existing** Stage 9A
orchestration — it does not duplicate any pipeline logic, and overlap protection
remains the job runner's advisory-lock responsibility.

- **Jobs**: `ingest`, `enrich`, `cluster`, `rank`, `pipeline` (allowlisted; any
  other path segment returns 404).
- **Auth**: `Authorization: Bearer <CRON_SECRET>`, checked in constant time. When
  `CRON_SECRET` is **unset the endpoint fails closed** — every request is 401 —
  so an unconfigured deployment can never be triggered anonymously. Set a long,
  high-entropy `CRON_SECRET` (server-only; never exposed or logged).
- **Response**: JSON operational summary (`kind`, `status`, counts, `durationMs`).
  `SUCCESS`/`PARTIAL` → HTTP 200; `FAILED` → HTTP 500. A lock-contended run is
  recorded as `SKIPPED` (still HTTP 200) exactly as the CLI reports it.
- **Runtime**: Node.js runtime, `dynamic = 'force-dynamic'`, `maxDuration = 60`.

Production scheduling options:

1. **Vercel Cron** (simplest for Vercel hosting):
   - `vercel.json` already schedules `/api/jobs/pipeline`
     (`7,22,37,52 * * * *`, i.e. every 15 min off the :00 mark). Tune the cadence
     to your Vercel plan's cron limits (Hobby is limited; Pro allows minute-level).
   - Vercel Cron issues **GET** and automatically attaches
     `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is set in the
     project — no extra wiring needed.
   - To run stages on separate cadences instead of the coordinated pipeline, add
     `/api/jobs/ingest`, `/api/jobs/enrich`, etc. entries.

2. **GitHub Actions** (repository-based):
   - A scheduled workflow `curl -X POST -H "Authorization: Bearer $CRON_SECRET"
     https://<host>/api/jobs/pipeline`; logs stored in Actions history.

3. **System cron** (dedicated server):
   - Either `curl` the endpoint (as above) or run `npm run jobs:*` directly.

4. **Inngest** (future enhancement):
   - Durable workflows with retries and observability; not implemented (the
     Stage 9A/10 model uses a simpler authenticated trigger).

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

Jobs use existing config plus the Stage 10 trigger secret:

- `DATABASE_URL` — required (PostgreSQL connection)
- `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` — optional (enrichment uses fake provider if unset)
- `EMBEDDING_PROVIDER` — optional (clustering uses fake provider by default)
- `GITHUB_TOKEN` — optional server-only token raising the GitHub API rate limit for Release ingestion (Stage 9B); never stored in `source_config` or logged
- `CRON_SECRET` — required to use the production job-trigger endpoint (Stage 10). Unset ⇒ the endpoint fails closed (401). Server-only; never exposed or logged

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

DB-gated integration suites exist and run in the GitHub Actions Postgres 16 +
pgvector job (`tests/jobs/*.integration.test.ts`,
`tests/ingestion/mixed-source.integration.test.ts`, and the Stage 10
`tests/jobs/http-trigger.integration.test.ts`). They cover:

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

The admin surfaces below already exist and are the primary operator UI (no
external observability platform is required to launch):

- **`/admin/jobs`** — the most recent `job_runs` with status, timing, results, and
  error summaries (read-only for all admin roles).
- **`/admin/fetches`** — recent `SourceFetch` attempts across all Sources with
  status filtering, HTTP/result info, counts, and error codes.
- **`/admin/sources`** — per-Source health, consecutive failure count, last
  success, and conditional-fetch state; the overview also counts Sources by
  health status.

### Operator monitoring runbook (Stage 10)

Answer the launch-critical operational questions using existing tables/surfaces —
no new infrastructure:

- **Are jobs running / when did the last pipeline succeed?**
  `/admin/jobs`, or:
  `SELECT job_name, status, started_at, finished_at FROM job_runs WHERE job_name = 'pipeline' ORDER BY started_at DESC LIMIT 5;`
  Last success: `... WHERE job_name = 'pipeline' AND status = 'SUCCEEDED' ORDER BY started_at DESC LIMIT 1;`
- **Which stage failed?** Each pipeline stage records its own child `job_runs`
  row (`ingest`/`enrich`/`cluster`/`rank`); a PARTIAL/FAILED parent points to the
  stage whose row is FAILED (or SKIPPED on lock contention). The row's
  `error_summary`/`metadata` carry the detail.
- **Which Sources are unhealthy?** `/admin/sources`, or:
  `SELECT slug, health_status, failure_count, last_success_at FROM sources WHERE health_status IN ('DEGRADED','FAILING') ORDER BY failure_count DESC;`
- **Are failures recurring?**
  `SELECT job_name, count(*) FILTER (WHERE status='FAILED') AS fails FROM job_runs WHERE started_at > NOW() - INTERVAL '24 hours' GROUP BY job_name ORDER BY fails DESC;`
  and for a Source's fetch history: `/admin/fetches` filtered by status.
- **Stuck jobs:** `SELECT * FROM job_runs WHERE status = 'RUNNING' AND started_at < NOW() - INTERVAL '1 hour';`

External error reporting (e.g. Sentry) is **not** wired in and is not required for
launch; add it later only if a concrete need arises.

## Security hardening (Stage 10)

- **Response headers** — every route carries baseline security headers
  (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy`, `Strict-Transport-Security`) via `next.config.mjs`;
  `X-Powered-By` is disabled. A strict `Content-Security-Policy` is **deferred**:
  a correct CSP for Next.js needs per-request script nonces, which is larger than
  Stage 10's scope. Track it as future hardening.
- **Job trigger** — authenticated + fails closed (see above); the only new public
  route, and it exposes no secrets or internals.
- **Secrets** — `DATABASE_URL`, `AI_API_KEY`, `GITHUB_TOKEN`, `ADMIN_SESSION_SECRET`,
  `CRON_SECRET` are all server-only (validated in `src/config/env.ts`), never sent
  to the browser and never logged.
- **Not added (deferred):** admin login rate-limiting requires a shared store
  (out of scope; the roster is env-configured, passwords are scrypt-hashed, and
  the surface is not publicly advertised). Revisit if the admin surface is exposed
  to untrusted networks.

## Backup & Recovery (Stage 10)

PostgreSQL is the single authoritative store; there is no custom backup
infrastructure and none should be built. Recovery relies on the managed database
provider (Supabase in production) plus this repository's deterministic migrations.

### Backup expectations

- **Managed provider backups.** Supabase performs automated daily backups on
  paid plans (and Point-in-Time Recovery on higher tiers). Confirm the project's
  plan actually has backups/PITR enabled before launch — a free-tier project may
  not. This is the primary recovery mechanism.
- **Schema is reproducible from source.** The ordered SQL migrations in
  `src/db/migrations` plus `schema_migrations` fully reconstruct the schema; no
  schema state lives outside the repository.

### Restore procedure

1. **Provision / restore the database.** Restore from the provider's latest
   backup or PITR to a new or existing instance (follow the provider's console
   flow). For a fresh instance with no data, skip to step 3.
2. **Point the app at it.** Set `DATABASE_URL` (and `DIRECT_URL` if used) to the
   restored instance.
3. **Apply migrations.** `npm run db:migrate` — idempotent; applies only missing
   migrations and records them in `schema_migrations`.
4. **Seed controlled reference data.** `npm run db:seed` — idempotent; inserts the
   controlled top-level Topic taxonomy if absent (does not create demo content).
5. **Validate the schema.** `npm run db:validate` — confirms connectivity and that
   all expected tables are present (`npm run db:setup` runs steps 3–5 together).

### Required secrets / configuration for recovery

`DATABASE_URL` (and optional `DIRECT_URL`); `ADMIN_SESSION_SECRET` + `ADMIN_USERS`
for the admin surface; `CRON_SECRET` for the job trigger; optionally `AI_PROVIDER`
/`AI_API_KEY`/`AI_MODEL`, `EMBEDDING_PROVIDER`, and `GITHUB_TOKEN`. These live only
in the deployment environment, never in the database, so they must be restored
from the secret manager, not from a database backup.

### Post-restore validation

- `npm run db:validate` passes (all expected tables present).
- The public portal renders (`/`, `/latest`) for a configured Publication domain.
- `/admin/login` authenticates and `/admin/jobs` loads.
- A manual `POST /api/jobs/rank` (with `CRON_SECRET`) returns HTTP 200 and records
  a `job_runs` row — confirming DB writes and the job path end-to-end.

> Recovery is **documented, not verified** here: perform a real restore drill in a
> staging project before relying on it. Do not claim recovery is tested until a
> drill has actually been run.

## Stage 9B — Developer Intelligence Sources

Stage 9B adds **GitHub Releases** and **Hacker News** as Source types. They reuse
the Stage 9A ingestion job and the Stage 3 engine unchanged — the ingestion job
processes them exactly like an RSS Source. Nothing about scheduling, locking, or
job persistence changes.

### Configuring a developer-intelligence Source

Create the Source in `/admin/sources` (or via the registry) and fill the
type-specific adapter config; it is stored in the `sources.source_config` JSONB
column and validated per type on save.

- **GitHub Releases** (`source_type = GITHUB`):
  `{ owner, repo, prereleases: exclude|include|only, perPage (1–100), maxPages
  (1–5) }`. The endpoint is always the official
  `https://api.github.com/repos/{owner}/{repo}/releases` — `owner`/`repo` are
  validated path segments, never an arbitrary URL. Releases only (never commits or
  issues). Drafts are always excluded; the prerelease policy is explicit.
- **Hacker News** (`source_type = HACKER_NEWS`):
  `{ mode: top|best|new|ids, maxItems (1–200), ids }`. The official Firebase API;
  story items only. Comments, deleted/dead, and malformed items are excluded. A
  text-only Ask HN uses its HN discussion URL as the canonical target.

### `GITHUB_TOKEN` (optional, server-only)

Set `GITHUB_TOKEN` in the environment to authenticate GitHub REST requests and
raise the rate limit above the anonymous ceiling. It is **never** stored in
`source_config`, sent to the browser, or logged. Unset means unauthenticated
requests. A GitHub 403/429 caused by rate limiting is classified as
`RATE_LIMITED` (retryable) and surfaced in the `SourceFetch` error code.

### Bounded API behaviour

Both providers are bounded by config and share the Stage 3 safe fetcher (timeout,
bounded redirects, response-size cap, SSRF protection). GitHub pagination is
capped by `perPage`/`maxPages`; Hacker News item fetches are capped by `maxItems`.
GitHub uses ETag conditional requests (a 304 short-circuits to `SKIPPED`). The
safe fetcher drops the `Authorization` header before following a cross-origin
redirect, so a token can never leak to a redirected host.

### Source health and PARTIAL/FAILED semantics

Hacker News fetches items individually. The run distinguishes **intentional
skips** (comment, dead/deleted, malformed — healthy) from **acquisition failures**
(timeout, network, 5xx, rate limit):

- some item failures with at least one success → `SourceFetch` **PARTIAL**
  (still a successful contact for health; failure detail is recorded in
  `metadata.itemsFailed` / `metadata.failures` with retryability);
- **every** requested item failing (zero items) → **FAILED**, which degrades
  Source health. This is never reported as a healthy `SUCCESS` with zero items.

A failure of the HN story-*list* fetch (a total outage) throws and fails the whole
Source, as for any other Source. GitHub fetches a single releases resource, so its
failures fail the Source directly.

### Edited GitHub release policy

Releases carry a **stable external id** (`github:release:{id}`). Re-ingesting an
edited release does not duplicate: the ingestion path uses `createOrRefresh`,
which refreshes the existing Article's **source facts in place** when the content
hash changes (or a newer `source_updated_at` arrives), counted as `itemsUpdated`
in the `SourceFetch` row. Only source-supplied columns are updated —
editorial/publication `status`, AI enrichment, Story membership, and ranking are
never touched. (GitHub's Releases payload has no top-level `updated_at`, so the
content hash is the primary edit signal; `updated_at` is read defensively if a
payload ever provides it.)

### Mixed-source ingestion job

The Stage 9A ingestion job processes RSS, GitHub, and Hacker News Sources in one
bounded run with no special-casing. A repeated run is idempotent (no duplicate
Articles), each Source records its own `SourceFetch`, and **nothing is
auto-published**. This is covered end-to-end against real Postgres in
`tests/ingestion/mixed-source.integration.test.ts` (including the Stage 9A
`runIngestionJob` path).

### No ranking use of GitHub/HN engagement

GitHub reactions and Hacker News score/comment counts are volatile engagement
signals. They are **not** captured onto the Article and **never** feed Stage 8
ranking. Ranking behaviour is unchanged by Stage 9B.

## Limitations & Future Work

### Not Implemented in Stage 9B

- **GitHub tracking beyond Releases** — star velocity, changelog intelligence,
  Tool profiles, Release Watch, and domain-specific GitHub Trending remain
  deferred (later Stage 9 work)
- **Admin UI for job runs** — visibility exists via SQL and `/admin/jobs`
- **Authenticated HTTP job endpoints** — only CLI is implemented; API routes can be added
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
