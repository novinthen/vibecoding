# Current Stage

# Stage 5 — Public Portal

## Status

**ACTIVE**

This file defines the only implementation scope currently approved.

Stage 3 (News Ingestion Engine) and Stage 4 (Admin & Editorial Operations) are
complete and merged. Do not begin Stage 5B (multi-publication localisation),
Stage 6 (AI), Stage 7 (Clustering), Stage 8 (Ranking/Trending), GitHub
ingestion, or Hacker News ingestion.

---

# Goal

Ship the first useful, publication-aware **public** vibe-coding news portal on
top of the existing canonical data. It must be fast, readable, source-transparent,
mobile-friendly, publication-aware, SEO-safe, and **honest about the current data
state** — it shows what genuinely exists and never fabricates Story intelligence,
trending, or AI summaries.

The public portal lives inside the same Next.js application (a modular monolith),
reads from PostgreSQL (the authoritative store), and never depends on a live AI
call.

---

# Implemented

1. **Publication resolution** — `hostname → PublicationDomain → Publication →
   public config`, resolved per request from the `Host`/`X-Forwarded-Host`
   header, with a sensible in-code **default Publication** fallback so the portal
   renders before any Publication is configured. No canonical domain, brand, or
   locale is hardcoded. Site name, locale, tagline, description, canonical URL
   base, and SEO metadata are publication-aware.
2. **Public routes** — `/` (home: Latest, primary-source updates, topic nav),
   `/latest`, `/article/[id]`, `/topic` + `/topic/[slug]`, `/tool` +
   `/tool/[slug]`, `/story/[slug]`, `/search`, `/about`, `/sources`.
3. **Article visibility** — a single domain rule
   (`src/domain/article-visibility.ts`), expressed as both a TypeScript predicate
   and a SQL fragment: publicly-visible = any status **except**
   `HIDDEN`/`DUPLICATE`/`FAILED`. Applied to every public Article query.
4. **Public data access** — a read-only `PublicContentRepository` and a
   `PublicationRepository` behind the existing repository boundary; a
   composition layer (`src/public/content.ts`) assembles page-ready view models
   with pagination. Public projections never expose internal hashes or status
   internals.
5. **Search** — MVP full-text search using **PostgreSQL only** (a generated
   `search_vector` tsvector + GIN index, queried with `websearch_to_tsquery`).
   No external search engine.
6. **Topic pages** — Articles associated through their Source's default Topic
   (including enabled child Topics), the only Article↔Topic relationship that
   exists today.
7. **Entity/Tool foundation** — public Entity index and detail reading existing
   Entity data; sparse (and honestly empty) until later enrichment stages
   populate Entities and Article↔Entity links.
8. **Story seam** — a real public Story route that renders **only** a published
   `PublicationStory` for the active Publication and 404s otherwise. No fake
   Story records are created.
9. **SEO/metadata** — publication-aware titles, descriptions, canonical URLs,
   Open Graph basics, robots directives, a dynamic sitemap, and conservative,
   escaped JSON-LD on Article pages using only real fields.
10. **Safety & attribution** — untrusted feed content is always escaped (never
    raw HTML); outbound URLs are validated before linking; each item preserves
    source name, original timestamp, and canonical URL with clear outbound
    access; no internal hashes, DB errors, admin metadata, or secrets are exposed.

See [`docs/PUBLIC_PORTAL.md`](PUBLIC_PORTAL.md) for the public architecture,
query/data-access design, and the honest-data-state decisions.

---

# Do Not Implement

- Trending/Important/ranking; AI summaries; why-it-matters generation; Entity
  extraction; embeddings generation; Story clustering;
- GitHub ingestion; Hacker News ingestion; arbitrary scraping;
- the Stage 5B multi-publication localisation/translation workflow (multiple
  deployed sites, `StoryLocalization` editing, per-publication RSS);
- personalised feeds; user accounts; alerts; recommendations; comments; payments;
- production scheduling; new queueing/search/database infrastructure.

Do not create fake data to compensate for deferred stages.

---

# Important Invariants

- Article ≠ Story; the Article page is the current factual public unit and is
  never presented as an AI-written Story.
- Public rendering reads only from PostgreSQL and never depends on a live AI call.
- Source facts (name, original URL, publication timestamp) are preserved and
  prominently linked; the portal is a discovery/intelligence layer, not a
  republishing engine, and does not reproduce full copyrighted articles.
- Feed-derived Article/Source content is untrusted and never rendered as unsafe
  HTML; outbound URLs are validated.
- No canonical domain logic assumes a single hostname, brand, or locale.
- No secrets, raw credentials, internal hashes, or stack traces are exposed
  publicly.

---

# Exit Criteria

Stage 5 is complete only when:

- the public routes above render correct states for present, missing, and empty
  data (e.g. unknown Topic/Story/Article → 404; no database configured → an
  honest "unavailable" state; empty feeds → honest empty states);
- Publication resolution works from the request hostname with a working default
  fallback, and metadata (title/description/canonical/OG/robots/sitemap) is
  publication-aware and free of hardcoded domains;
- Article visibility, Topic filtering, and search behave correctly and safely
  against the existing schema;
- untrusted feed content renders safely and outbound links are validated;
- tests (publication resolution, visibility, public queries, topic filtering,
  search, safe rendering, safe outbound links, canonical metadata, empty/missing
  states), the DB integration tests, the Stage 3 ingestion regression tests, the
  Stage 4 admin/auth regression tests, typecheck, lint, format check, the full
  test suite, and the production build all pass.

---

# HARD STOP

Do not begin Stage 5B, Stage 6, Stage 7, ranking, GitHub ingestion, or Hacker
News ingestion without explicit approval. Do not merge to `main` without review.
