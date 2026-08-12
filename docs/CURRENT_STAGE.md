# Current Stage

# Stage 10 — Production Hardening & Launch Readiness

## Status

**COMPLETE (pending review)**

Stages 3–9B are complete and merged to `main`. Stage 10 is **not** a feature
stage: it inspects, tests, and hardens the existing system so it can be safely
deployed. Method: **audit → fix → test → document**, with small corrections to
existing code only — no new architecture, no product expansion.

Do not begin Stage 11.

---

# Goal

Make the existing product safer to launch without making it bigger. The pipeline
already exists end to end:

```
source acquisition → normalization → Article persistence/dedup → AI enrichment
  → Story clustering → publication/localisation → ranking → production automation
  → public portal
```

Stage 10 adds the missing production glue and hardening around that pipeline.

## Preserved invariants (unchanged by Stage 10)

- Article source facts are never overwritten by AI/clustering/ranking (Stage 9B's
  stable-external-id source-fact refresh remains the only in-place update).
- Article ≠ Story.
- Publishing stays editorial — nothing auto-publishes.
- AI stays advisory — never promoted into canonical/editorial fields.
- Ranking stays deterministic (Stage 8 weights/semantics unchanged).
- Clustering stays conservative (REVIEWED/LOCKED protection intact).
- Publication isolation — no Story presentation, localisation, ranking, canonical
  URL, or domain config leaks across Publications.
- Secrets stay server-only (`DATABASE_URL`, `AI_API_KEY`, `GITHUB_TOKEN`,
  `ADMIN_SESSION_SECRET`, `CRON_SECRET`).

---

# Implemented

1. **Baseline security headers** (`next.config.mjs`) — applied to every route:
   `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy:
   strict-origin-when-cross-origin`, `Permissions-Policy`, and HSTS; `X-Powered-By`
   remains disabled. A strict `Content-Security-Policy` is **deferred** (needs
   per-request Next.js nonces) and documented as future hardening.

2. **Authenticated production job trigger** — `POST|GET /api/jobs/[job]`
   (`src/app/api/jobs/[job]/route.ts` + `src/jobs/http-trigger.ts`). Invokes the
   **existing** Stage 9A orchestration (`runJob` / `runPipelineWithLock`); no new
   pipeline. `Authorization: Bearer <CRON_SECRET>`, constant-time checked, **fails
   closed** when the secret is unset. Bounded to the allowlisted jobs
   (`ingest`/`enrich`/`cluster`/`rank`/`pipeline`); overlap protection remains the
   job runner's advisory lock. Scheduled via `vercel.json` (Vercel Cron) or any
   external scheduler. Returns an operational summary only (no secrets/internals).

3. **Operator monitoring runbook** (`docs/OPERATIONS.md`) — how to answer the
   launch-critical questions (jobs running? last pipeline success? which stage
   failed? which Sources unhealthy? recurring failures?) using existing
   `job_runs` / `SourceFetch` / Source-health data and the `/admin/jobs`,
   `/admin/fetches`, `/admin/sources` surfaces. No new observability platform.

4. **Backup & recovery procedure** (`docs/OPERATIONS.md`) — documented against the
   managed provider (Supabase) plus the repository's idempotent migrations
   (restore → `db:migrate` → `db:seed` → `db:validate`), with required secrets and
   post-restore validation. Documented, **not** drill-verified.

5. **Public error boundary** (`src/app/(public)/error.tsx`) — a branded fallback
   that shows no internal detail.

6. **Documentation truth pass** — corrected stale "to be added / not implemented /
   no production scheduling" claims across `README`, `OPERATIONS`, `ADMIN`, and
   this file to match the actual `main` codebase.

## Deferred (not launch-blocking)

- Strict Content-Security-Policy (needs Next.js nonce integration).
- Admin login rate-limiting (needs a shared store; roster is env-configured,
  scrypt-hashed, and not publicly advertised).
- External error reporting (Sentry/OTel) — add later only if a concrete need
  arises.
- A real restore drill to move recovery from "documented" to "verified".

---

# Exit Criteria

- ✅ production readiness audit completed and findings classified
- ✅ justified BLOCKER/HIGH/MEDIUM fixes implemented (no BLOCKERs found)
- ✅ authenticated, bounded, fail-closed production job trigger reusing Stage 9A
- ✅ security response headers on every route
- ✅ monitoring + backup/recovery runbooks documented
- ✅ documentation matches the actual codebase
- ✅ tests for the new security boundaries (trigger auth/allowlist, headers,
  DB-gated dispatch + lock)
- ✅ typecheck, lint, format check pass
- ✅ production build succeeds
- ✅ full DB-enabled suite green on Postgres 16 + pgvector CI

---

# HARD STOP

Do not begin Stage 11. Stage 10 is pushed to its branch for review and is **not**
merged to `main` here.
