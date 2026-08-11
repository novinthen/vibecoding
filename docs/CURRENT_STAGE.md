# Current Stage

# Stage 9A — Production Automation & Scheduling

## Status

**COMPLETE**

Stage 3 (News Ingestion Engine), Stage 4 (Admin & Editorial Operations), Stage 5
(Public Portal), Stage 5B (Multi-Publication Localisation), Stage 6 (AI
Intelligence), Stage 7 (Story Clustering & Canonical Intelligence), Stage 8
(Ranking, Trending & Editorial Prioritisation), and Stage 9A (Production
Automation & Scheduling) are complete.

Do not begin Stage 9B (Developer Intelligence) without explicit approval.

---

# Goal

Make the existing pipeline capable of running safely and repeatedly in production
without manual intervention. Build a job orchestration layer that processes
Sources, enriches Articles, clusters Stories, and ranks them — all automatically,
bounded, and observable.

```
scheduled trigger
  → bounded ingestion
  → bounded enrichment
  → bounded clustering
  → bounded ranking
  → health/audit/reporting
  → next scheduled run
```

## Core invariant

**Automation NEVER auto-publishes.** PublicationStory remains the publishing
boundary. Jobs enrich, cluster, and rank, but only editors publish Stories.

---

# Implemented

1. **Job orchestration** (`src/jobs/job-runner.ts`) — common lifecycle for all
   jobs: lock acquisition, run persistence, execution, completion, lock release.
   Every run creates exactly one `job_runs` row (even on failure).

2. **Advisory locking** (`src/jobs/locking.ts`) — PostgreSQL-native overlap
   prevention using `pg_try_advisory_lock`. Session-scoped (auto-releases on
   crash), non-blocking (no deadlock risk), job-specific (different jobs run
   concurrently).

3. **Job persistence** (migration `0017`) — `job_runs` table stores structured
   summaries: status, timing, counts (attempted/succeeded/skipped/failed),
   retryable failure count, error summary, metadata. Supports operational
   queries: currently running, last successful run, recent history.

4. **Ingestion job** (`src/jobs/ingestion-job.ts`) — processes enabled Sources
   (respects health status), batch-limited, isolates per-Source failures, reuses
   Stage 3 ingestion unchanged.

5. **Enrichment job** (`src/jobs/enrichment-job.ts`) — processes Articles
   without current enrichment, eligibility-gated (has text, not HIDDEN/DUPLICATE),
   batch-limited (100 default), reuses Stage 6 enrichment service unchanged.

6. **Clustering job** (`src/jobs/clustering-job.ts`) — processes unclustered
   Articles, batch-limited (50 default), respects REVIEWED/LOCKED Story
   protection, reuses Stage 7 clustering engine unchanged.

7. **Ranking job** (`src/jobs/ranking-job.ts`) — processes ACTIVE Stories, skips
   recent rankings (< 1 hour unless forced), batch-limited (100 default), reuses
   Stage 8 ranking engine unchanged.

8. **Pipeline job** (`src/jobs/pipeline-job.ts`) — orchestrates full sequence:
   ingest → enrich → cluster → rank. Each stage independently bounded, partial
   failures isolated, configurable stop-on-partial policy.

9. **CLI runner** (`scripts/run-job.ts`) — command-line interface for all jobs:
   `npm run jobs:ingest`, `jobs:enrich`, `jobs:cluster`, `jobs:rank`,
   `jobs:pipeline`. Each prints outcome summary, exits with appropriate code.

10. **Tests** — 3 test suites: locking (advisory lock behavior, overlap
    prevention, concurrent jobs), job-runner (status derivation SUCCEEDED/PARTIAL/
    FAILED), job-run-repository (persistence, queries). All unit tests passing.

11. **Documentation** — comprehensive operations guide (`docs/OPERATIONS.md`)
    covers architecture, job types, locking, persistence, CLI usage, scheduling
    recommendations, retry policy, invariants, deployment steps, monitoring
    queries, limitations, and future enhancements.

---

# Job Invariants

All jobs maintain these guarantees:

1. **Bounded execution** — no unbounded loops; all batches size-limited
2. **Idempotent** — re-running is safe (skips already-current items)
3. **Isolated failures** — one bad item does not crash entire batch
4. **No auto-publishing** — jobs enrich/cluster/rank but never publish Stories
5. **Article provenance preserved** — jobs never overwrite Article source facts
6. **Short transactions** — no DB locks held across network/AI calls
7. **Overlapping runs prevented** — advisory locks serialize same-job runs
8. **Observable** — every run persists outcome to `job_runs` (even failures)
9. **REVIEWED/LOCKED protection** — clustering never auto-modifies protected Stories
10. **Editorial override remains** — admin can operate manually if automation disabled

---

# Scheduling

Jobs can be triggered via:

- **CLI** — `npm run jobs:ingest`, `jobs:enrich`, `jobs:cluster`, `jobs:rank`,
  `jobs:pipeline`
- **External scheduler** (production) — cron, Vercel Cron, GitHub Actions, or
  platform scheduler calling CLI or (future) authenticated API endpoint

Recommended cadences (environment-configurable):
- Ingestion: every 5–15 minutes
- Enrichment: every 10–30 minutes
- Clustering: every 10–30 minutes
- Ranking: every 10–30 minutes

Avoid :00 and :30 minute marks when possible (spread load across minutes).

---

# Exit Criteria

Stage 9A is complete when:

- ✅ job orchestration layer implemented (runner, locking, persistence)
- ✅ all four job types implemented (ingestion, enrichment, clustering, ranking)
- ✅ pipeline orchestrator implemented (coordinated sequence)
- ✅ advisory locks prevent overlapping runs
- ✅ job_runs table stores structured summaries
- ✅ CLI commands for all jobs
- ✅ jobs are bounded (batch limits enforced)
- ✅ jobs are idempotent (safe to re-run)
- ✅ per-item failures isolated (one bad item doesn't crash batch)
- ✅ no auto-publishing anywhere
- ✅ Article source facts never mutated by automation
- ✅ REVIEWED/LOCKED Story protection respected
- ✅ tests pass (locking, runner, repository)
- ✅ typecheck passes
- ✅ build succeeds
- ✅ documentation updated (OPERATIONS.md, CURRENT_STAGE.md, README.md)

---

# HARD STOP

Do not begin Stage 9B (Developer Intelligence) without explicit approval. Do not
merge to `main` without review.

---

# What's Next

**Stage 9B — Developer Intelligence** (NOT YET APPROVED):
- GitHub repository tracking
- Release intelligence
- Star velocity
- Changelog monitoring
- Hacker News integration
- Tool profiles

Await explicit approval before beginning Stage 9B.
