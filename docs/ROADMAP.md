# Development Roadmap

This roadmap defines the approved build sequence.

Do not implement future stages early merely because they appear here.

---

## Stage 0 — Product Definition

**Status:** COMPLETE

Deliverables:

- product positioning;
- user groups;
- editorial scope;
- top-level taxonomy;
- source hierarchy;
- MVP boundaries;
- success definition.

Reference: `PRODUCT.md`

---

## Stage 1 — System & Data Architecture

**Status:** COMPLETE

Deliverables:

- modular-monolith decision;
- stack;
- domain boundaries;
- source-adapter architecture;
- data architecture;
- AI boundary;
- job architecture;
- search direction;
- security and testing principles.

References:

- `ARCHITECTURE.md`
- `DATA_MODEL.md`

---

## Stage 2 — Foundation & Data Layer

**Status:** COMPLETE

Goal:

Create the reproducible, tested repository and canonical data foundation.

Major deliverables:

- Next.js application foundation;
- multi-publication-safe domain foundation;
- strict TypeScript;
- code-quality tooling;
- test infrastructure;
- environment validation;
- Supabase/PostgreSQL integration;
- migrations;
- canonical data model;
- initial taxonomy seed;
- data-access layer;
- CI;
- setup documentation.

Explicitly exclude ingestion and AI.

See: `CURRENT_STAGE.md`

---

## Stage 3 — News Ingestion Engine

**Status:** COMPLETE

Goal:

Make the project a functioning aggregator.

Expected work:

- source-adapter contract;
- RSS / Atom ingestion;
- URL canonicalization;
- exact deduplication;
- scheduler;
- source health;
- fetch audit;
- normalization;
- first real Source Registry;
- ingestion tests.

Rollout rule:

First prove the ingestion architecture against a small, representative set of approved sources covering different feed behaviours. Validate normalization, deduplication, retries, health reporting, and observability before expanding the registry.

Stage success condition:

After representative-source validation passes, expand progressively until **30+ approved high-quality sources ingest reliably**. Do not add 30 sources simultaneously merely to satisfy a count target.

---

## Stage 4 — Admin & Editorial Operations

**Status:** COMPLETE

Goal:

Make the aggregation system operable by humans.

Expected work:

- admin authentication;
- source management;
- fetch history;
- source health dashboard;
- Article review;
- Story management foundations;
- Entity/Topic controls;
- editorial audit flows.

---

## Stage 5 — Public Portal

**Status:** CURRENT

Goal:

Ship the first useful publication-aware public news product. The rendering layer must resolve the active Publication from the request hostname and support publication-specific branding, locale, Story selection, slugs, and SEO metadata.

Expected pages:

- homepage;
- Latest;
- Trending shell;
- Story;
- Topic;
- Tool;
- Search.

Focus:

speed, readability, attribution, mobile experience, SEO foundations.

---

## Stage 5B — Multi-Publication Localisation

Goal:

Enable multiple domains/languages to publish from the same canonical Story engine without duplicating ingestion or factual intelligence.

Expected work:

- Publication configuration;
- PublicationDomain routing;
- PublicationStory controls;
- Story localisation;
- translation/adaptation workflow;
- per-publication SEO metadata;
- per-publication sitemap/RSS;
- editorial review of machine translations.

This may be implemented alongside or immediately after the first public portal depending on launch priorities.

---

## Stage 6 — AI Intelligence

Goal:

Enrich Articles and Stories without compromising provenance.

Expected work:

- relevance classification;
- Entity extraction;
- Topic assignment;
- summaries;
- why-it-matters;
- provider abstraction;
- confidence;
- AI benchmark dataset;
- prompt/version auditability.

---

## Stage 7 — Story Clustering

Goal:

Turn duplicate reporting into consolidated Stories.

Expected work:

- candidate retrieval;
- title similarity;
- Entity overlap;
- embeddings;
- cluster confidence;
- JOIN / NEW / REVIEW outcomes;
- merge/split editorial controls.

---

## Stage 8 — Ranking & Trending

Goal:

Separate Latest from Trending and Important.

Expected inputs:

- freshness;
- source authority;
- source diversity;
- coverage velocity;
- community signals;
- GitHub signals;
- novelty;
- editorial override.

Ranking must remain inspectable.

---

## Stage 9 — Developer Intelligence

**Status:** Stage 9A COMPLETE, Stage 9B COMPLETE (Developer Intelligence Source Expansion — GitHub Releases + Hacker News)

### Stage 9A — Production Automation & Scheduling (COMPLETE)

Goal: Make the existing pipeline capable of running safely and repeatedly in production without manual intervention.

Deliverables:
- bounded, idempotent job orchestration (ingestion, enrichment, clustering, ranking, pipeline);
- session-correct PostgreSQL advisory locks (dedicated PoolClient);
- job persistence and observability (`job_runs` table, `/admin/jobs` page);
- CLI interface (`npm run jobs:*`);
- finite default batch limits (ingestion: 50, enrichment: 100, clustering: 50, ranking: 100);
- pipeline stage locks (standalone job cannot overlap pipeline stage);
- dependency ordering (pipeline stops if required stage lock is held);
- external scheduler ready (cron/Vercel Cron/GitHub Actions);
- comprehensive operations guide (`docs/OPERATIONS.md`).

Reference: `docs/CURRENT_STAGE.md`, `docs/OPERATIONS.md`

### Stage 9B — Developer Intelligence Source Expansion (COMPLETE)

Goal: Expand acquisition to the two highest-value developer-intelligence inputs
without building new pipelines.

Delivered:

- source-type acquisition/dispatch seam (`src/ingestion/acquire`) reusing the
  existing NormalizedItem → canonicalization → Article/dedup → SourceFetch/health
  → enrichment → clustering → ranking → Stage 9A automation flow unchanged;
- per-source `source_config` (migration `0018`) with per-type Zod validation and
  admin plumbing;
- **GitHub Releases** via the official REST API — releases only, bounded
  pagination, draft exclusion, explicit prerelease policy, stable release id,
  canonical release URL, bounded excerpt, ETag conditional requests, optional
  server-only token, 403/429 rate-limit classification;
- **Hacker News** via the official Firebase API — story items only,
  comment/deleted/dead/malformed exclusion, `top`/`best`/`new`/explicit ids,
  external target or HN discussion URL; engagement counts never affect ranking;
- deterministic fixture/unit tests for both providers, a mixed-source PostgreSQL
  integration test, and cross-origin token-leak protection in the safe fetcher.

Deferred to later stages (NOT in 9B): star velocity, changelog intelligence,
Tool profiles, Release Watch, domain-specific GitHub Trending.

---

## Stage 10 — Production Hardening & Launch (COMPLETE, pending review)

Goal: make the existing system safer to launch (audit → fix → test → document) —
not bigger.

Delivered:

- production readiness audit (security / reliability / performance / AI-cost /
  public-launch / operations), no BLOCKERs found;
- baseline security response headers on every route (`next.config.mjs`);
- authenticated, bounded, fail-closed production job trigger
  (`POST|GET /api/jobs/[job]`) reusing the Stage 9A orchestration, scheduled via
  `vercel.json`;
- operator monitoring runbook over existing `job_runs` / `SourceFetch` / Source
  health;
- backup & recovery procedure (managed provider + idempotent migrations;
  documented, not drill-verified);
- public error boundary; documentation truth pass;
- tests for the new security boundaries + Postgres CI regression gate.

Verified already-present hardening (no change needed): SSRF guard, host-header /
canonical-URL poisoning protection, multi-publication isolation, admin auth
(HMAC session + roster reconciliation), bounded AI (30s timeout, 8k-char input),
bounded/paginated queries, outbound-link safety, and source attribution.

Deferred (not launch-blocking): strict CSP (needs Next.js nonces), admin
login rate-limiting (needs a shared store), external error reporting, and a real
restore drill.

---

# Deferred Until Product Validation

Do not prioritize before the core product is proven:

- native mobile apps;
- comments;
- public posting;
- social graph;
- complex personalization;
- subscriptions/payments;
- custom recommendation ML;
- live chat;
- browser extensions;
- Kubernetes;
- microservices;
- arbitrary crawling infrastructure.
