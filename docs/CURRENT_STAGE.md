# Current Stage

# Stage 3 — News Ingestion Engine

## Status

**ACTIVE**

This file defines the only implementation scope currently approved.

Stage 2 (Foundation & Data Layer) is complete. Do not begin Stage 4 or any later
stage (Admin/Editorial, Public Portal, AI, Clustering, Ranking, GitHub or Hacker
News ingestion).

---

# Goal

Build the first reliable news-ingestion pipeline on top of the Stage 2 canonical
data model. The target flow is:

```text
Source
  → fetch
  → parse
  → normalize
  → canonicalize URL
  → exact deduplication
  → Article persistence
  → SourceFetch audit
  → Source health state
```

Ingestion creates/updates **Articles**, never Stories.

---

# Implement

1. Source Adapter contract (`validate / fetch / normalize / healthCheck` seam).
2. RSS and Atom support first (one adapter over RSS 2.0, RSS 1.0/RDF, Atom 1.0).
3. Safe HTTP fetching:
   - timeout;
   - redirect limit (manual, re-validated per hop);
   - conditional requests (ETag / Last-Modified);
   - source-aware rate-control seam;
   - retryable vs non-retryable error classification;
   - SSRF protections.
4. Normalize feed items into one canonical ingestion shape.
5. URL canonicalization (safe host/scheme/path normalization, tracking-parameter
   removal, preservation of unknown parameters).
6. Exact duplicate prevention using existing Article constraints and
   deterministic keys/hashes.
7. Persist Articles through the existing data-access layer.
8. Record every fetch attempt in SourceFetch.
9. Derive/update Source health from fetch results.
10. Manual/CLI ingestion entry point for testing specific Sources.
11. Extend CI/tests.

## Representative-source rule

Prove the architecture on a small representative set (different feed behaviours)
before expanding. Tricky behaviours (redirect/tracking URLs, malformed/failing
feeds) are proven with stored fixtures in the test suite; live registry feeds are
validated only via an opt-in smoke suite (`INGEST_LIVE_SMOKE=1`). Do not expand
the registry broadly yet.

---

# Do Not Implement

- GitHub ingestion; Hacker News ingestion; RSSHub-specific adapters; arbitrary
  scraping; browser automation;
- AI, summaries, Entity extraction, embeddings, Story clustering, ranking/trending,
  translation/localisation;
- public portal redesign; admin UI beyond minimal operational seams;
- scheduled production polling (unless needed to prove the architecture);
- Redis, Kafka, RabbitMQ, Elasticsearch, a crawler service, or microservices.

---

# Important Invariants

- Article ≠ Story; ingestion creates/updates Articles only.
- Source facts remain untouched by AI-derived data.
- One ingestion run is idempotent; fetching the same item twice creates no
  duplicate Article.
- External feeds/URLs/HTML are untrusted input.
- A broken Source never silently disappears; failures are observable through
  SourceFetch and Source health.
- One slow/failing Source must not corrupt other Sources.
- Canonical intelligence remains publication-independent.

---

# Exit Criteria

Stage 3 is complete only when:

- the Source Adapter contract exists and RSS/Atom parse into one canonical shape;
- fetching is timeout-, redirect-, size-, and SSRF-bounded, issues conditional
  requests, and classifies retryable vs non-retryable errors;
- URL canonicalization strips tracking parameters and preserves meaningful ones;
- exact deduplication prevents duplicate Articles and re-ingestion is idempotent;
- every fetch attempt is recorded in SourceFetch and Source health transitions
  deterministically;
- a CLI ingestion entry point can register and ingest specific Sources;
- deterministic fixture tests, DB integration tests, typecheck, lint, format
  check, the full test suite, and the production build all pass.

Live representative-source validation may follow once the above passes; keep any
live smoke tests out of normal CI.

---

# HARD STOP

Do not begin Stage 4 or later without explicit approval.
