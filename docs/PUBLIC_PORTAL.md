# Public Portal (Stage 5 + 5B)

The public portal is the useful, publication-aware, localisation-ready public
surface for the Vibe Coding News Portal. It is part of the same Next.js modular monolith, reads
from PostgreSQL (the authoritative store), and never depends on a live AI call.

This document describes the public architecture, the honest handling of the
current data state, and the security/attribution safeguards.

## Honest data-state decisions

AI relevance classification (Stage 6) and Story clustering (Stage 7) do not exist
yet, so the portal deliberately does **not** invent them:

- **Articles are the current factual public unit, gated by explicit publishing.**
  An Article is publicly visible **only** when its status is `PUBLISHED`. Every
  pre-publication lifecycle state (`DISCOVERED`, `NORMALIZED`, `QUEUED`,
  `ENRICHED`, `CLUSTERED`) and every excluded state (`HIDDEN`, `DUPLICATE`,
  `FAILED`) is non-public. Stage 3 ingestion continues to create Articles in its
  existing initial state (it does **not** auto-publish); Stage 4's editorial
  status control is the current manual publishing gate. Later stages (6/7) may
  promote suitable Articles/Stories into `PUBLISHED`, but Stage 5 does not
  anticipate that by exposing pre-publication records. The rule lives once, in
  `src/domain/article-visibility.ts`, as both a TypeScript predicate
  (`isPubliclyVisibleArticle`) and a SQL fragment (`publicArticleStatusSql`,
  emitting `status IN ('PUBLISHED')`) that agree by construction, and it is
  applied by every public Article query — home, Latest, `/article/[id]` (a
  non-`PUBLISHED` id 404s), Topic pages, Search, and Source listings.
- **No Trending/Important/AI summaries.** These modules are omitted, not faked.
- **The Story route is a real seam, not fake data.** `/story/[slug]` renders only
  a genuinely published `PublicationStory` for the active Publication and 404s
  otherwise. Since no Stories are published yet, it 404s everywhere today — but
  the query path and rendering are real and tested, ready for Stage 6/7.
- **Tool/Entity pages are honestly sparse.** They read existing Entity data; no
  speculative Entities are created to make pages look full.

## Publication resolution

Resolution is `hostname → enabled PublicationDomain → ACTIVE Publication → public
config`:

1. `getActivePublication()` (`src/public/request.ts`) reads the request host
   (`X-Forwarded-Host`, then `Host`), normalises it (lowercase, strip port), and
   looks it up via `PublicationRepository.findByDomain` — matching an **enabled**
   domain to an **ACTIVE** Publication.
2. The pure `resolvePublicationContext` decides the outcome, returning one of:
   - **`database`** — the host resolved. The row is projected to a small
     render-facing `PublicationConfig` (`resolvePublicationConfig`), and the
     canonical base URL is built from the **validated, normalised domain** — never
     from the raw request header.
   - **`default`** — no Publication matched, but this is **local/preview**
     (`APP_ENV` ≠ `production`), so the in-code **default Publication** (site name
     from `NEXT_PUBLIC_APP_NAME`, locale `en`) keeps development practical.
   - **`unresolved`** — this is **production** and the host did not resolve. The
     portal **fails closed**.

### Fail closed in production

Production must not silently serve an arbitrary/unconfigured hostname as a valid
Publication. When `APP_ENV=production` and the request host does not resolve to an
enabled `PublicationDomain` on an `ACTIVE` Publication:

- the default Publication is **not** served;
- **no** canonical/OG URL is derived from the unrecognised host;
- public pages return **404** (`requireServedPublication()` calls `notFound()`),
  `robots.txt` disallows everything and advertises no host, and the sitemap is
  empty.

Because the canonical base for a resolved Publication is built from the validated
domain (not the `Host`/`X-Forwarded-Host` header), and an unresolved production
host is rejected outright, an untrusted header value can never poison canonical
metadata. `APP_ENV` (the deployment target, distinct from `NODE_ENV`) is the
signal: `preview` is treated like development so previews stay usable. No
production domain is hardcoded anywhere.

### Stage 5B — multi-publication localisation (implemented)

The Stage 5B localisation workflow is now implemented on top of the resolution
seam above. Highlights:

- **Publication administration** lives at `/admin/publications` (server-authorized,
  audited): list/create/edit/(de)activate Publications; default locale, timezone,
  branding, SEO, and editorial profile; add/remove/enable/disable domains with a
  primary per Publication and global domain uniqueness.

  **PublicationDomain lifecycle invariants** (enforced atomically per mutation):
  - a **DISABLED** domain is never primary;
  - **at most one** primary domain per Publication (DB partial unique index);
  - an **ACTIVE** Publication with ≥1 enabled domain has **exactly one enabled
    primary**.

  Rules: the **first** domain of a Publication becomes primary automatically
  (regardless of the checkbox); a later domain is primary only when explicitly
  selected, atomically replacing the previous primary; a disabled domain cannot
  be made primary. When the current primary is **disabled or removed**, a
  deterministic replacement (the oldest remaining *enabled* domain) is promoted
  automatically — and if there is **no** enabled replacement while the
  Publication is **ACTIVE**, the mutation is refused (deactivate first).
  Re-enabling a domain when the Publication has no primary promotes it. New
  Publications are created **INACTIVE**; activation is refused unless an enabled
  primary domain exists. A Publication with no domains may remain INACTIVE.
- **PublicationStory** attaches a real canonical Story to a Publication and edits
  only per-Publication presentation (slug/headline/summary/why-it-matters/
  featured/priority/status). Canonical Story facts are never touched, and the
  same Story may be published by many Publications with different headlines.
- **StoryLocalization** stores locale rows (one per `(publication_story, locale)`)
  with localized text, status, translation provenance, and reviewer. Stage 5B is
  manual/editorial + import only — no automated translation provider runs.

#### Public locale resolution and fallback

Locale selection is deterministic and **publication-controlled**. The domain
determines the Publication; the locale is then:

1. a valid `?locale=` request parameter, when present and well-formed; else
2. the Publication's `default_locale`.

Browser `Accept-Language` is never consulted (`src/public/locale.ts`). Once a
locale is chosen, content resolution (`getStoryPage`) applies, in order:

1. an approved (**PUBLISHED**) `StoryLocalization` for the chosen locale;
2. else the Publication's default-locale localisation;
3. else the Publication's own canonical publication copy (the deliberate
   fallback).

Every localisation read is scoped to the resolved `PublicationStory`, so content
is **never** borrowed from another locale beyond this rule, and **never** from
another Publication. `<html lang>` reflects the Publication default; a Story
served in a non-default locale additionally marks the rendered locale on its
content element and in route metadata (OG locale + hreflang alternates).

#### SEO and feeds

- Canonical URLs are per-Publication (built from the validated domain). A
  localised view canonicalises to its own `?locale=` variant; hreflang
  `alternates.languages` list the Story's approved locales **within the same
  Publication origin only** — an independent Malay Publication is never
  cross-canonicalised to an English one.
- `sitemap.xml` lists real published Stories for the resolved Publication.
- `/feed.xml` is a publication-aware Atom feed: the Publication's domain,
  PUBLISHED Story selection, editorial copy, default-locale metadata, and
  Publication attribution. It fails closed on an unresolved production host and
  is honestly empty when no Stories are published.

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

All data routes are `force-dynamic` (they read the request host and live data).
In local/preview they degrade to an honest "unavailable" state when no database
is configured; in production an unresolved host fails closed with a 404 (see
above). `Topic`, `Article`, `Tool`, and `Story` routes return **404** for unknown
slugs/ids (a non-UUID article id 404s without hitting the database), and a
direct `/article/[id]` request for a non-`PUBLISHED` Article also returns 404.

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
- `tests/public/resolution.test.ts` — production fail-closed vs. dev fallback, and
  canonical base built only from a validated host (no header poisoning).
- `tests/public/visibility.test.ts` — PUBLISHED-only rule; predicate ⇔ SQL agreement.
- `tests/public/metadata.test.ts` — canonical URLs, robots noindex, JSON-LD escaping.
- `tests/public/format.test.ts` — deterministic date/excerpt formatting.
- `tests/public/safe-url.test.ts` — outbound-URL safety.
- `tests/public/rendering.test.tsx` — safe rendering of hostile Article content and links.
- `tests/public/content.integration.test.ts` — DB-gated: Publication resolution,
  Article visibility, Topic filtering, search, Source counts, Entity reads,
  pagination, and the Story seam (empty and populated).

### Stage 5B tests

- `tests/domain/locale.test.ts` — BCP-47-ish locale validation/canonicalisation.
- `tests/public/locale.test.ts` — locale policy: target selection + fallback merge.
- `tests/public/feed.test.ts` — Atom feed structure, escaping, empty feed.
- `tests/public/metadata.test.ts` — OG locale override + same-origin hreflang alternates.
- `tests/admin/validation.test.ts` — Publication/domain/localisation schema parsing.
- `tests/admin/publications.integration.test.ts` — DB-gated: publication/domain
  authorization + audit, domain uniqueness, one-primary-domain invariant,
  PublicationStory separation from canonical facts, localisation parentage,
  one-locale-per-PublicationStory, multi-locale, same Story localised by
  different Publications, and cross-Publication isolation.
- `tests/public/localization.integration.test.ts` — DB-gated: public locale
  fallback, PUBLISHED-only localisation visibility, and no cross-Publication
  leakage.
