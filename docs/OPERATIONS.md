# Operations

## Overview

The portal uses the Stage 9A bounded job layer for production automation and the
Stage 9B source-acquisition seam for RSS/Atom, GitHub Releases, and Hacker News.
PostgreSQL is authoritative. Publishing remains editorial: automation may ingest,
enrich, cluster, and rank, but it never publishes a Story.

The core automated flow is:

```text
external scheduler / operator
  → CLI or authenticated HTTP trigger
  → Stage 9A job runner
  → advisory lock
  → job_runs persistence
  → ingest → enrich → cluster → rank
```

No queue, Redis, Kafka, Inngest workflow, or second pipeline is required for the
current architecture.

---

## Job architecture

All automated jobs share the lifecycle in `src/jobs/job-runner.ts`:

1. acquire a PostgreSQL advisory lock for the job name;
2. persist a RUNNING `job_runs` row;
3. execute a bounded job implementation;
4. persist SUCCEEDED / PARTIAL / FAILED / SKIPPED outcome;
5. release the advisory lock.

Session-correct locking uses a dedicated `PoolClient` for the lock lifetime. The
actual job work uses the normal pool and does not keep a database transaction open
across network or AI calls.

### Available jobs

```bash
npm run jobs:ingest
npm run jobs:enrich
npm run jobs:cluster
npm run jobs:rank
npm run jobs:pipeline
```

Default Stage 9A limits:

| Job | Default bound |
| --- | ---: |
| ingestion | 50 Sources |
| enrichment | 100 Articles |
| clustering | 50 Articles |
| ranking | 100 Stories |

Explicit ID modes are capped as well.

The coordinated pipeline executes in dependency order:

```text
ingest → enrich → cluster → rank
```

If a required stage is SKIPPED because its stage lock is already held, the
pipeline stops and downstream stages do not execute. The parent pipeline is not
reported as SUCCEEDED in that case.

---

## Production HTTP trigger (Stage 10)

The application exposes:

```text
POST|GET /api/jobs/[job]
```

Allowed job names:

- `ingest`
- `enrich`
- `cluster`
- `rank`
- `pipeline`

The endpoint calls the existing Stage 9A orchestration. It does not duplicate job
or pipeline logic.

### Authentication

Requests must include:

```text
Authorization: Bearer <CRON_SECRET>
```

`CRON_SECRET` is server-only.

- unset → endpoint fails closed with 401;
- production + configured secret shorter than 32 characters → configuration
  resolution fails;
- production secret of at least 32 characters → accepted for comparison;
- comparison is length-safe and uses `timingSafeEqual`.

A lock-held SKIPPED run is expected overlap prevention and maps to HTTP 200.
Only a genuine terminal FAILED result maps to HTTP 500.

### Runtime budget: important deployment rule

The HTTP route currently declares:

```text
maxDuration = 60
```

**No checked-in Vercel cron schedule is shipped.** This is deliberate.

The application cannot truthfully guarantee that the full pipeline—or even every
individual network-backed job—will always complete inside a 60-second serverless
budget. Examples:

- Anthropic enrichment has a whole-operation timeout of up to 30 seconds per
  Article and enrichment is sequential;
- one ingestion Source may perform multiple bounded provider requests (for
  example GitHub pagination or multiple Hacker News item fetches);
- database latency is external to the application and cannot be converted into a
  strict universal wall-clock guarantee by batch size alone.

Therefore the production rule is:

> Configure a scheduler only after measuring the selected job in the actual
> deployment environment and proving that its worst-case operational envelope is
> compatible with that runtime's execution limit.

Do not infer “safe for 60 seconds” merely from a small item batch.

### Scheduling choices

#### 1. Long-lived runner / system cron

Safest option for the complete coordinated pipeline when execution may exceed a
short serverless function budget:

```bash
npm run jobs:pipeline
```

The CLI uses exactly the same Stage 9A orchestration and locks.

#### 2. External scheduler calling the HTTP endpoint

A scheduler may call one of the authenticated endpoints, for example:

```bash
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://<host>/api/jobs/rank
```

Before scheduling, measure that specific job in the target deployment plan.
Use off-peak minutes where practical.

#### 3. Vercel Cron

The endpoint supports GET because Vercel Cron issues GET requests, but **this
repository intentionally does not commit `vercel.json` cron entries**. Add a
Vercel schedule only after the project's actual plan/runtime limit and the chosen
job's measured worst-case duration are known.

Do not schedule `/api/jobs/pipeline` on a 60-second function budget unless it has
been proven to fit with safety margin under real provider/network conditions.

#### 4. GitHub Actions

A scheduled workflow can call the authenticated endpoint, or a suitable runner
can execute the CLI directly when the application environment and secrets are
available.

### Suggested cadence ranges

These are operational starting points, not guarantees or hard-coded policy:

- ingestion: every 5–15 minutes;
- enrichment: every 10–30 minutes;
- clustering: every 10–30 minutes;
- ranking: every 10–30 minutes;
- coordinated pipeline: only when the selected runtime can safely accommodate it.

---

## Retry behavior

Stage 9A does not implement an autonomous retry loop.

Retryable failures include network timeouts, provider rate limits, transient 5xx
errors, and other explicitly classified transient failures. They are recorded in
`job_runs.retryable_failures` and retried naturally when the external scheduler
runs the job again.

Non-retryable failures include invalid configuration, malformed deterministic
input, authorization/configuration errors, and invalid AI output.

This keeps retries bounded and observable.

---

## Job observability

### Admin

Operators can inspect:

- `/admin/jobs` — recent `job_runs`, statuses, counts, timings, error summaries;
- `/admin/fetches` — SourceFetch history and acquisition failures;
- `/admin/sources` — Source health, failure count, last success, validators.

### Useful SQL

Recent pipeline runs:

```sql
SELECT job_name, status, started_at, finished_at, duration_ms, error_summary
FROM job_runs
WHERE job_name = 'pipeline'
ORDER BY started_at DESC
LIMIT 10;
```

Last successful pipeline:

```sql
SELECT *
FROM job_runs
WHERE job_name = 'pipeline' AND status = 'SUCCEEDED'
ORDER BY finished_at DESC
LIMIT 1;
```

Potentially stuck jobs:

```sql
SELECT *
FROM job_runs
WHERE status = 'RUNNING'
  AND started_at < NOW() - INTERVAL '1 hour';
```

Unhealthy Sources:

```sql
SELECT slug, health_status, failure_count, last_success_at
FROM sources
WHERE health_status IN ('DEGRADED', 'FAILING')
ORDER BY failure_count DESC;
```

External alerting/Sentry/OTel is not required by the current architecture and was
not added in Stage 10. Add it later only when there is a concrete operational
need.

---

## Source operations (Stage 9B)

### GitHub Releases

Source configuration lives in `sources.source_config`:

```text
owner
repo
prereleases: exclude | include | only
perPage: 1–100
maxPages: 1–5
```

The endpoint is constructed from validated owner/repository identifiers; arbitrary
GitHub API URLs are not accepted.

`GITHUB_TOKEN` is optional and server-only. It is never stored in
`source_config`, returned to the browser, or logged. Authentication headers are
removed before a cross-origin redirect.

Draft releases are excluded. Stable release IDs prevent duplicates. Edited
releases refresh source-derived Article fields through the provenance-safe
`createOrRefresh` path and do not change editorial status, AI enrichment, Story
membership, or ranking.

### Hacker News

Supported modes:

```text
top
best
new
ids
```

`maxItems` is bounded. Comments, deleted/dead records, and malformed/non-story
items are intentional skips.

Per-item acquisition errors are distinct from skips:

- some item failures + some success → PARTIAL;
- every requested item failing → FAILED;
- intentional skips do not by themselves make Source health unhealthy.

HN score/comment counts do not feed Stage 8 ranking.

---

## Security operations

Baseline response headers are configured in `next.config.mjs`:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- restrictive `Permissions-Policy`
- `Strict-Transport-Security`

`X-Powered-By` is disabled.

A strict CSP is deferred because a correct Next.js CSP requires a nonce strategy;
Stage 10 does not add a partially correct CSP merely for checklist compliance.

Server-only secrets include:

- `DATABASE_URL`
- `DIRECT_URL`
- `ADMIN_SESSION_SECRET`
- `ADMIN_USERS`
- `AI_API_KEY`
- `GITHUB_TOKEN`
- `CRON_SECRET`

Do not log them or expose them to client components.

Admin login rate limiting remains deferred; adding a shared rate-limit store only
for that purpose would expand architecture without a demonstrated launch blocker.

---

## Backup and recovery

PostgreSQL is the single authoritative store. No custom backup infrastructure is
implemented.

Before launch, confirm the managed database plan actually provides the required
backup/PITR capability. Do not assume a provider tier includes it.

### Restore procedure

1. restore/provision the PostgreSQL database using the managed provider;
2. restore deployment secrets from the secret manager;
3. point `DATABASE_URL` / `DIRECT_URL` at the restored instance;
4. run `npm run db:migrate`;
5. run `npm run db:seed`;
6. run `npm run db:validate`;
7. verify public publication-domain rendering;
8. verify `/admin/login` and `/admin/jobs`;
9. run a controlled job and confirm a new `job_runs` row is persisted.

`npm run db:setup` performs migrate + seed + validate.

Recovery is documented but **not considered verified** until a real restore drill
is performed against a staging/managed database.

---

## Deployment checklist

Before enabling production automation:

1. deploy the application from a green `main`;
2. set `DATABASE_URL` and optional `DIRECT_URL`;
3. set `ADMIN_SESSION_SECRET` (minimum 32 chars in production) and `ADMIN_USERS`;
4. set a strong `CRON_SECRET` (minimum 32 chars in production) if using the HTTP
   job trigger;
5. set optional `AI_PROVIDER` / `AI_API_KEY` / `AI_MODEL` and `GITHUB_TOKEN` as
   required;
6. run `npm run db:setup`;
7. configure every production hostname as an enabled PublicationDomain on an
   ACTIVE Publication;
8. manually exercise the intended job path;
9. inspect `/admin/jobs`, `/admin/fetches`, and `/admin/sources`;
10. measure the intended scheduled job in the actual runtime;
11. only then configure the external scheduler;
12. confirm managed database backups/PITR and perform a restore drill before
    claiming recovery is verified.

---

## Rollback

If production automation causes problems:

1. disable the external scheduler;
2. leave the HTTP trigger secret configured or rotate/remove it as appropriate;
3. continue operating jobs manually through the CLI if needed;
4. inspect `job_runs` and `SourceFetch` for the failure boundary;
5. roll back application deployment using the hosting platform;
6. do not delete `job_runs` or source evidence as part of ordinary rollback.

The automation layer is additive and publishing remains editorial, so disabling
scheduling does not prevent manual administration of Sources, Articles, Stories,
Publications, or rankings.

---

## Invariants

Production operations must preserve these rules:

1. jobs are bounded;
2. same-name job overlap is prevented;
3. no database transaction spans a network/AI call;
4. individual failures are isolated and observable;
5. no automated path publishes a Story;
6. Article source facts are not overwritten by AI/clustering/ranking;
7. reviewed/locked Story protections remain intact;
8. GitHub/HN remain new inputs to the existing pipeline, not new pipelines;
9. secrets remain server-only;
10. scheduler configuration must match the real runtime budget rather than an
    assumed one.

## See also

- `docs/ARCHITECTURE.MD`
- `docs/DATA_MODEL.md`
- `docs/ADMIN.md`
- `docs/PUBLIC_PORTAL.md`
- `docs/CURRENT_STAGE.md`
- `src/jobs/`
- `src/ingestion/`
