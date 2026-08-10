# Public Portal (Stage 5)

The public portal is the first useful, publication-aware public surface for the
Vibe Coding News Portal. It is part of the same Next.js modular monolith, reads
from PostgreSQL (the authoritative store), and never depends on a live AI call.

This document describes the public architecture, the honest handling of the
current data state, and the security/attribution safeguards.

## Honest data-state decisions

AI relevance classification (Stage 6) and Story clustering (Stage 7) do not exist
yet, so the portal deliberately does **not** invent them:

- **Articles are the current factual public unit.** Ingested Articles land in
  `DISCOVERED`; there is no meaningful "PUBLISHED" gate yet. Rather than fake a
  curated feed, the portal shows genuinely ingested Articles and hides exactly
  the three states that must never be public: `HIDDEN` (editorially removed),
  `DUPLICATE` (exact-dedup), and `FAILED` (bad ingestion). This rule lives once,
  in `src/domain/article-visibility.ts`, as both a TypeScript predicate and a SQL
  fragment that agree by construction.
- **No Trending/Important/AI summaries.** These modules are omitted, not faked.
- **The Story route is a real seam, not fake data.** `/story/[slug]` renders only
  a genuinely published `PublicationStory` for the active Publication and 404s
  otherwise. Since no Stories are published yet, it 404s everywhere today — but
  the query path and rendering are real and tested, ready for Stage 6/7.
- **Tool/Entity pages are honestly sparse.** They read existing Entity data; no
  speculative Entities are created to make pages look full.

## Publication resolution

Resolution is `hostname → PublicationDomain → Publication → public config`:

1. `getActivePublication()` (`src/public/request.ts`) reads the request host
   (`X-Forwarded-Host`, then `Host`), normalises it (lowercase, strip port), and
   looks it up via `PublicationRepository.findByDomain` — matching an **enabled**
   domain to an **ACTIVE** Publication.
2. The row is projected to a small render-facing `PublicationConfig`
   (`resolvePublicationConfig`), reading branding/SEO overrides from the
   Publication's JSONB columns.
3. When no database is configured, no host is present, or no Publication maps to
   the host, it falls back to an **in-code default Publication** (site name from
   `NEXT_PUBLIC_APP_NAME`, locale `en`). No production domain, brand, or locale is
   hardcoded, and the canonical URL base is derived from the request host.

The full Stage 5B localisation workflow (StoryLocalization editing, per-publication
RSS, translation review, multiple deployed sites) is intentionally **out of
scope**.

## Data access

Public reads go through the existing repository boundary:

- `PublicContentRepository` (`src/domain/repositories`) — join-resolved public
  reads (Article + Source + source-derived Topic, Topic/Source counts, Entities,
  Story membership). Every Article query applies `publicArticleStatusSql`. All
  external inputs are bound parameters; the only inlined SQL is the visibility
  predicate, built from the controlled vocabulary (no injection surface).
- `PublicationRepository` — hostname → Publication resolution.
- `src/public/content.ts` — a thin composition layer that resolves slugs, gathers
  lists, and computes pagination, returning page-ready view models. Empty inputs
  yield empty results (honest empty states), never errors.

Public projection types (`src/public/types.ts`) are camelCased and deliberately
exclude internal fields (url_hash, content_hash, status internals) so they can
never leak to a public surface.

## Routes

| Route             | Purpose                                                            |
| ----------------- | ----------------------------------------------------------------- |
| `/`               | Home: Latest, primary-source updates, topic navigation            |
| `/latest`         | Chronological, paginated feed                                     |
| `/article/[id]`   | Article detail (the current factual public unit)                  |
| `/topic`          | Topic index (controlled taxonomy with visible-article counts)     |
| `/topic/[slug]`   | Articles for a Topic (self + enabled children)                    |
| `/tool`           | Entity/Tool index (sparse until enrichment)                       |
| `/tool/[slug]`    | Entity detail + linked coverage                                   |
| `/story/[slug]`   | Published Story for the active Publication, else 404              |
| `/search`         | MVP PostgreSQL full-text search                                   |
| `/about`          | Coverage, source selection, attribution philosophy               |
| `/sources`        | Enabled public sources grouped by authority tier                 |

All data routes are `force-dynamic` (they read the request host and live data)
and degrade to an honest "unavailable" state when no database is configured.
`Topic`, `Article`, `Tool`, and `Story` routes return **404** for unknown
slugs/ids (a non-UUID article id 404s without hitting the database).

## Search

MVP search uses **PostgreSQL only** (per the approved architecture — no
Elasticsearch/Meilisearch/Typesense). Migration `0013` adds a generated, STORED
`search_vector tsvector` over `original_title` + `original_excerpt` with a GIN
index; queries use `websearch_to_tsquery('english', …)` ranked by `ts_rank` then
recency, restricted to publicly-visible Articles. Search-result pages are
`noindex`.

## SEO / metadata

`buildMetadata` (`src/public/metadata.ts`) is a pure, testable function producing
publication-aware titles, descriptions, canonical URLs, Open Graph basics, and
robots directives from `{ config, baseUrl, path }`. Canonical/OG URLs are built
from the request host (never a hardcoded domain). `robots.ts` disallows `/admin`
and `/search`; `sitemap.ts` lists the static navigation plus live Topic, Tool,
and recent Article URLs, all host-aware. Article pages include conservative
schema.org JSON-LD using only real fields (no fabricated authors, dates, or
ratings); the serialized JSON escapes `<` so untrusted values can never break out
of the `<script>` element.

## Safety & attribution

- **Untrusted content** (titles, excerpts, URLs from feeds) is always rendered as
  escaped React text; there is no unsafe raw-HTML rendering of feed content.
- **Outbound URLs** pass through the shared `safeExternalUrl` policy
  (`src/lib/safe-url.ts`) — only http(s) becomes a `rel="noopener noreferrer
  nofollow" target="_blank"` link; anything else is inert text.
- **Attribution** is preserved on every item: source name, original publication
  timestamp, and a prominent outbound link to the original publisher. The portal
  shows metadata and short source-provided excerpts, not full copyrighted
  articles.
- **No leakage**: internal hashes, DB errors, admin metadata, ingestion
  diagnostics, and secrets are never exposed publicly; resolution failures fall
  back silently to the default Publication.

## Tests

- `tests/public/publication.test.ts` — hostname normalisation and config projection.
- `tests/public/visibility.test.ts` — the visibility predicate ⇔ SQL agreement.
- `tests/public/metadata.test.ts` — canonical URLs, robots noindex, JSON-LD escaping.
- `tests/public/format.test.ts` — deterministic date/excerpt formatting.
- `tests/public/safe-url.test.ts` — outbound-URL safety.
- `tests/public/rendering.test.tsx` — safe rendering of hostile Article content and links.
- `tests/public/content.integration.test.ts` — DB-gated: Publication resolution,
  Article visibility, Topic filtering, search, Source counts, Entity reads,
  pagination, and the Story seam (empty and populated).
