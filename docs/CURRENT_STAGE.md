# Current Stage

# Stage 9A — Production Automation & Scheduling

## Status

**COMPLETE** (with final corrections)

Stage 3 (News Ingestion Engine), Stage 4 (Admin & Editorial Operations), Stage 5 (Public Portal), Stage 5B (Multi-Publication Localisation), Stage 6 (AI Intelligence), Stage 7 (Story Clustering & Canonical Intelligence), Stage 8 (Ranking, Trending & Editorial Prioritisation), and Stage 9A (Production Automation & Scheduling) are complete.

Do not begin Stage 9B (Developer Intelligence) without explicit approval.

---

# Goal

Make the existing pipeline capable of running safely and repeatedly in production without manual intervention. Build a job orchestration layer that processes Sources, enriches Articles, clusters Stories, and ranks them — all automatically, bounded, and observable.

```
scheduled trigger
  → bounded ingestion
  → bounded enrichment
  → bounded clustering
  → bounded ranking
  → health/audit/reporting
  → next scheduled run
```

## Core invariants

1. **Automation NEVER auto-publishes.** PublicationStory remains the publishing boundary.
2. **Session-correct locking.** Lock acquire/release use dedicated PoolClient (same PostgreSQL session).
3. **Bounded execution.** All jobs have finite default batch limits.
4. **Dependency ordering.** Pipeline STOPS if required stage lock is held.
5. **No transactions span network/AI calls.** Short transactions for persistence only.

---

# Final Corrections Applied

## 1. Pipeline Dependency Ordering (Critical Fix)

**Problem:** Pipeline continued when a required stage was SKIPPED (lock held), violating dependency ordering.

**Example failure:**
- standalone ingestion running
- pipeline starts
- pipeline ingestion SKIPPED (lock held)
- pipeline enrichment starts IMMEDIATELY ❌
- standalone ingestion still creating Articles
- enrichment misses those Articles (dependency race)

**Fix:** Pipeline now STOPS when a required stage lock is held:
- Stage SKIPPED → record child job_run, STOP pipeline
- Downstream stages DO NOT execute
- Parent pipeline reports PARTIAL/FAILED (not SUCCEEDED)

**Validated:** Integration tests prove pipeline stops, downstream stages don't execute, metadata identifies lock contention.

## 2. Advisory Lock Release Hardening

**Problem:** If `pg_advisory_unlock` throws while session remains alive, returning client to pool could leak the lock.

**Fix:** Lock release now destroys failed connections:
```typescript
try {
  await client.query('SELECT pg_advisory_unlock(...)');
  client.release(); // Normal return
} catch (error) {
  client.release(error); // Destroy connection (lock may still be held)
  throw error;
}
```

**Invariant:** A connection whose unlock could not be confirmed is never returned to the reusable pool.

## 3. Job-Level Skip Counter Semantics

**Problem:** Lock-refused job had `skipped = 0` even though the job itself was skipped.

**Fix:** When `status = 'SKIPPED'`, the `skipped` counter is now 1 (the job itself was skipped).

---

# Implemented

1. **Job orchestration** (`src/jobs/job-runner.ts`) — common lifecycle for all jobs: lock acquisition (dedicated PoolClient), run persistence, execution, completion, lock release. Every run creates exactly one `job_runs` row (even on lock refusal).

2. **Session-correct advisory locks** (`src/jobs/locking.ts`) — PostgreSQL-native overlap prevention using dedicated `PoolClient` for entire lock lifetime. Lock acquire and release guaranteed to use same session. Failed unlock destroys connection.

3. **Job persistence** (migration `0017`) — `job_runs` table stores structured summaries: status (RUNNING/SUCCEEDED/PARTIAL/FAILED/SKIPPED), timing, counts, error summary, metadata. Supports operational queries: currently running, last success, overlap attempts.

4. **Ingestion job** (`src/jobs/ingestion-job.ts`) — processes enabled Sources (respects health, default batch: 50), isolates per-Source failures, reuses Stage 3 ingestion unchanged.

5. **Enrichment job** (`src/jobs/enrichment-job.ts`) — processes Articles without current enrichment, eligibility-gated (has text, not HIDDEN/DUPLICATE), default batch: 100, reuses Stage 6 enrichment service unchanged.

6. **Clustering job** (`src/jobs/clustering-job.ts`) — processes unclustered Articles, default batch: 50, respects REVIEWED/LOCKED Story protection, reuses Stage 7 clustering engine unchanged.

7. **Ranking job** (`src/jobs/ranking-job.ts`) — processes ACTIVE Stories, skips recent rankings (< 1 hour unless forced), default batch: 100, reuses Stage 8 ranking engine unchanged.

8. **Pipeline job** (`src/jobs/pipeline-job.ts`) — orchestrates full sequence: ingest → enrich → cluster → rank. Each stage runs through `runJob()` with its own lock. Pipeline STOPS if required stage lock is held (dependency ordering).

9. **CLI runner** (`scripts/run-job.ts`) — command-line interface for all jobs: `npm run jobs:ingest`, `jobs:enrich`, `jobs:cluster`, `jobs:rank`, `jobs:pipeline`. Each prints outcome summary, exits with appropriate code.

10. **Admin visibility** (`/admin/jobs`) — shows recent 50 job runs with status, timing, results, errors. Read-only for all admin roles.

11. **Integration tests** — 17 tests across 4 suites (locking, job-runner, pipeline, pipeline-correctness). All DB-gated, all pass.

12. **Documentation** — comprehensive operations guide (`docs/OPERATIONS.md`), updated ARCHITECTURE.MD, DATA_MODEL.md, ADMIN.md, ROADMAP.md, README.md.

Reuses Stage 3/6/7/8 engines unchanged (no business logic duplication).

---

# Job Invariants

All jobs maintain these guarantees:

1. **Bounded execution** — finite default batch limits enforced
2. **Idempotent** — re-running is safe (skips already-current items)
3. **Isolated failures** — one bad item does not crash entire batch
4. **No auto-publishing** — jobs enrich/cluster/rank but never publish Stories
5. **Article provenance preserved** — jobs never overwrite Article source facts
6. **Short transactions** — no DB locks held across network/AI calls
7. **Overlapping runs prevented** — advisory locks serialize same-job runs
8. **Observable** — every run persists outcome to `job_runs` (including SKIPPED)
9. **REVIEWED/LOCKED protection** — clustering never auto-modifies protected Stories
10. **Editorial override remains** — admin can operate manually if automation disabled
11. **Session-correct locks** — dedicated PoolClient for entire lock lifetime
12. **Dependency ordering** — pipeline stops if required stage lock is held

---

# Exit Criteria

Stage 9A is complete when:

- ✅ job orchestration layer implemented (runner, locking, persistence)
- ✅ all four job types implemented (ingestion, enrichment, clustering, ranking)
- ✅ pipeline orchestrator implemented (coordinated sequence with stage locks)
- ✅ session-correct advisory locks (dedicated PoolClient)
- ✅ advisory lock release hardening (failed unlock destroys connection)
- ✅ pipeline dependency ordering (stops if required stage lock held)
- ✅ job_runs table stores structured summaries
- ✅ CLI commands for all jobs
- ✅ jobs are bounded (finite default batch limits)
- ✅ jobs are idempotent (safe to re-run)
- ✅ per-item failures isolated (one bad item doesn't crash batch)
- ✅ no auto-publishing anywhere
- ✅ Article source facts never mutated by automation
- ✅ REVIEWED/LOCKED Story protection respected
- ✅ admin job visibility (/admin/jobs page)
- ✅ integration tests pass (17 tests, 4 suites, all DB-gated)
- ✅ typecheck passes
- ✅ lint passes
- ✅ build succeeds
- ✅ documentation updated (README, ARCHITECTURE, DATA_MODEL, ADMIN, ROADMAP, OPERATIONS)

---

# HARD STOP

Do not begin Stage 9B (Developer Intelligence) without explicit approval. Do not merge to `main` without review.

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
