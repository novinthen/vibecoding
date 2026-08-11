# Current Stage

# Stage 9B — Developer Intelligence Source Expansion

## Status

**COMPLETE**

Stages 3–9A are complete. Stage 9B expands acquisition to two new
developer-intelligence inputs — **GitHub Releases** and **Hacker News** — without
building any new pipelines.

Do not begin Stage 10 without explicit approval.

---

# Goal

Add GitHub Releases and Hacker News as first-class Sources that flow through the
**existing** ingestion engine. They are new *inputs*, not new *pipelines*:

```
source-specific acquisition (RSS/Atom | GitHub Releases | Hacker News)
  → existing NormalizedItem
  → existing canonicalization + hashing
  → existing Article persistence / exact dedup
  → existing SourceFetch audit + Source health
  → existing enrichment
  → existing clustering
  → existing ranking
  → existing Stage 9A automation
```

## Core invariants

1. **One pipeline.** No separate GitHub/HN Article pipeline. Dispatch happens at
   acquisition; everything downstream is format-agnostic and shared.
2. **No auto-publishing.** Acquisition never publishes; PublicationStory remains
   the publishing boundary.
3. **Source facts only.** Acquirers write Article source facts (title, url,
   excerpt, author, timestamps) — never AI-derived data, never engagement.
4. **Reuse the safe fetcher.** Every provider fetches through the Stage 3 safe
   fetcher, so SSRF, redirect bounds, timeout, and size caps apply identically.
5. **Secrets stay server-only.** Provider credentials live in the environment
   (`GITHUB_TOKEN`), never in `source_config`, never logged.

---

# Implemented

1. **Source configuration** — `source_config` JSONB column (migration `0018`),
   per-type Zod validation (`src/ingestion/source-config.ts`), repository
   persistence (create/upsert/update), and admin plumbing (validation, service,
   audit view, and an "Adapter config (JSON)" form field).

2. **Acquisition/dispatch seam** (`src/ingestion/acquire`) — `SourceAcquirer`
   contract producing a canonical `AcquisitionResult`; `ingestSource` dispatches
   on `source_type`. The RSS/Atom path is factored into `feedAcquirer` with
   identical behaviour and remains the default for RSS/ATOM/RSSHUB/API/MANUAL.

3. **GitHub Releases acquirer** (`github-acquirer.ts`) — official REST API,
   releases only; validated `owner`/`repo` build the fixed
   `api.github.com/repos/{owner}/{repo}/releases` endpoint; bounded pagination;
   draft exclusion; explicit prerelease policy (`exclude`/`include`/`only`);
   stable `github:release:{id}` external id (edited releases never duplicate);
   `html_url` canonical target; bounded release-note excerpt; ETag conditional
   requests; optional server-only Bearer token; 403/429 rate-limit
   classification.

4. **Hacker News acquirer** (`hacker-news-acquirer.ts`) — official Firebase API,
   story items only; excludes comments, deleted/dead, and malformed items;
   bounded `top`/`best`/`new`/explicit ids; external target URL where present or
   the HN discussion URL for text-only Ask HN; stable `hn:item:{id}` external id.
   Score/comment counts are NOT captured onto the Article and never affect
   Stage 8 ranking.

5. **Safe-fetcher hardening** — optional extra request headers (JSON `Accept`,
   API version, `Authorization`); the `Authorization` header is dropped before a
   cross-origin redirect so a provider token cannot leak; a small allow-listed
   set of rate-limit response headers is attached to 4xx/5xx errors for
   provider-specific classification. RSS/Atom behaviour is unchanged.

6. **Registry** — one representative GitHub Source (`nextjs-releases`) and one
   Hacker News Source (`hacker-news-top`), gated (not auto-enabled).

7. **Tests** — deterministic fixture/unit tests for the GitHub and HN acquirers,
   the fetcher's header/redirect/rate-limit behaviour, an in-memory dispatch
   test proving GitHub/HN flow through `ingestSource` with dedup and
   stable-id-on-edit, and a DB-gated mixed-source integration test (RSS + GitHub
   + HN through one engine, no duplicates, SourceFetch rows present, no
   auto-publish). No required test performs a live GitHub/HN call.

---

# Exit Criteria

Stage 9B is complete when:

- ✅ `source_config` migration + per-type validation + repository/admin plumbing
- ✅ acquisition/dispatch seam; RSS/Atom path preserved unchanged
- ✅ GitHub Releases acquirer meeting all requirements (bounded, draft/prerelease
  policy, stable id, canonical URL, bounded excerpt, ETag, rate-limit, token)
- ✅ Hacker News acquirer (story-only, exclusions, url selection, bounded)
- ✅ no separate GitHub/HN pipeline; downstream stages untouched
- ✅ no auto-publishing; no Stage 8 ranking change from HN engagement
- ✅ SSRF/security model preserved; token never leaked or logged
- ✅ deterministic GitHub + HN tests (no live calls in CI)
- ✅ mixed-source PostgreSQL integration test
- ✅ typecheck, lint, format check pass
- ✅ production build succeeds
- ✅ documentation updated (ARCHITECTURE, DATA_MODEL, ROADMAP, ADMIN, this file)

---

# HARD STOP

Do not begin Stage 10 without explicit approval. Do not merge to `main` without
review.
