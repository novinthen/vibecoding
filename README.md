# Vibe Coding News Portal

An AI-enriched news aggregation and intelligence platform focused on the
**vibe-coding ecosystem**: AI coding tools, coding agents, AI-assisted IDEs,
MCP, important model developments, developer infrastructure, GitHub activity,
releases, and developer-community signals.

It is **not** a generic AI-news site and **not** a personal RSS reader. The
long-term positioning is _Techmeme + Hacker News + GitHub intelligence + an AI
analyst_, focused on AI-assisted software development, and it is designed as a
**multi-publication** platform: one canonical intelligence backend can power
many websites, domains, brands, and languages.

See [`docs/PRODUCT.md`](docs/PRODUCT.md),
[`docs/ARCHITECTURE.MD`](docs/ARCHITECTURE.MD), and
[`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) for the full product and
architecture definitions.

## Current stage

**Stage 9A — Production Automation & Scheduling.**

The platform now has bounded, safe, repeatable job automation for the full intelligence pipeline (ingestion → enrichment → clustering → ranking). Jobs run automatically without manual intervention while preserving editorial control and observability.

**Key capabilities:**
- **Session-correct advisory locks** — PostgreSQL-native overlap prevention using dedicated PoolClient
- **Bounded execution** — all jobs have finite default batch limits (ingestion: 50, enrichment: 100, clustering: 50, ranking: 100)
- **Stage lock isolation** — standalone jobs cannot overlap pipeline stages (dependency ordering preserved)
- **Observability** — all runs persisted to `job_runs` table, admin UI at `/admin/jobs`
- **CLI interface** — `npm run jobs:ingest`, `jobs:enrich`, `jobs:cluster`, `jobs:rank`, `jobs:pipeline`
- **External scheduler ready** — cron/Vercel Cron/GitHub Actions can trigger jobs via CLI

See [`docs/CURRENT_STAGE.md`](docs/CURRENT_STAGE.md) and [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

---

### Previously: Stage 8 — Ranking, Trending & Editorial Prioritisation

On top of the Stage 3 ingestion engine, Stage 4 admin, Stage 5 public portal,
Stage 5B localisation, Stage 6 AI intelligence, and Stage 7 Story clustering,
Stage 8 adds transparent, versioned ranking that answers "Which Stories matter
most right now?" through deterministic, explainable scoring.

### Stage 8: Ranking system

- **Transparent ranking** — 6 deterministic signals (freshness, source diversity,
  authority, story activity, novelty, AI importance) + editorial adjustment,
  combined via weighted sum with explicit version control (`ranking-score-v1`).
- **Publication-aware** — same Story may rank differently per Publication;
  editorial overrides (featured, priority, suppression) are per-publication.
- **Append-only provenance** — every ranking calculation is versioned and
  timestamped in `story_rankings`; history is preserved, never overwritten.
- **Admin ranking UI** — Story detail page shows current ranking score, signal
  breakdown, version, timestamp, history, and manual trigger (authorized,
  audited via `AdminRankingService`).
- **Public integration** — `/top` route displays top-ranked published Stories;
  ranking queries respect PublicationStory settings and exclude suppressed
  Stories.
- **Invariants preserved** — ranking never alters Story membership, Article
  source facts, or auto-publishes Stories. Ranking is advisory and explainable.

---

### Previously: Stage 7 — Story Clustering

**Stage 7 — Story Clustering & Canonical Intelligence.**

On top of the Stage 3 ingestion engine, Stage 4 admin, the Stage 5 public portal,
the Stage 5B localisation layer, and the Stage 6 AI-enrichment layer, this
repository now adds the first trustworthy **Story clustering** layer. It groups
Articles that describe the same underlying event into canonical Stories while
preserving every Article as independent evidence (**Article ≠ Story**):

```
Articles → bounded candidate generation → deterministic multi-signal scoring
  → conservative cluster decision → Story + StoryArticles → reviewable provenance
```

Key properties:

- **Embedding boundary** (`src/clustering/embedding`) mirroring the AI provider
  boundary: a deterministic `FakeEmbeddingProvider` (feature hashing, no network)
  is the only provider, so required CI is offline and reproducible; a real
  provider is a drop-in. Embeddings are derived data, versioned/provenanced, and
  never written to Article source fields.
- **Bounded, explainable candidates** — embedding nearest-neighbours (exact
  pgvector `<=>` within a time window) plus shared-Entity Stories; never all-pairs.
- **Deterministic, versioned scoring** (`cluster-score-v1`) combining embedding
  similarity, title overlap, shared entities, and temporal proximity — with a hard
  evidence gate, a conservative threshold, and an ambiguity margin. Not an opaque
  LLM decision.
- **Conservative & safe** — biases to **false split > false merge**: two similarly
  strong matches are left AMBIGUOUS (unclustered) rather than merged. Re-runs are
  idempotent and concurrency-safe (per-Article advisory lock). Clustering never
  mutates Article source facts, never publishes, and never auto-modifies a
  REVIEWED/LOCKED Story.
- **Reviewable provenance** — every attempt is an append-only `clustering_decisions`
  row (method/version, outcome, confidence, scored candidate set). The admin
  `/admin/stories` surface reviews members, decisions, source diversity, and offers
  audited attach/detach/create/move/review operations.
- **Optional & isolated** — clustering defaults to the fake provider and, when
  unavailable, never affects ingestion, admin, or public rendering; scores/review
  states are never exposed publicly and publishing stays the PublicationStory
  boundary.

Clustering is triggered **manually** by a mutating admin (no production
scheduling). See [`docs/CURRENT_STAGE.md`](docs/CURRENT_STAGE.md),
[`docs/ARCHITECTURE.MD`](docs/ARCHITECTURE.MD) (Clustering Architecture), and
[`docs/ADMIN.md`](docs/ADMIN.md).

Stage 7 adds one migration (`0015`) that extends the embeddings, `stories`, and
`story_articles` tables in place and adds the `clustering_decisions` log.

---

### Previously: Stage 6 — AI Intelligence

Stage 6 added a **safe, versioned AI-enrichment layer** for canonical Articles. AI
helps interpret source facts without becoming the source of truth:

```
Article source facts → provider-neutral AI request → strict-schema validation
  → versioned enrichment record → admin review → (later, separately approved)
  controlled promotion
```

Key properties:

- **Provider-neutral boundary** (`src/ai/provider`) with a deterministic
  `FakeProvider` (tests/local smoke, no network) and a thin `AnthropicProvider`
  over `fetch` (no vendor SDK). API keys are server-only.
- **Strict structured output** — every reply is machine-validated against a
  `.strict()` schema; malformed/partial output is rejected and recorded, never
  silently accepted.
- **Prompt-injection boundary** — trusted instructions and untrusted Article text
  are kept strictly separate; Article content is data, never instructions.
- **Versioned & auditable** — each attempt (success, invalid output, provider
  error) is an immutable new version in `article_enrichments`; re-running never
  destroys prior provenance.
- **Advisory only** — AI never overwrites source facts, never publishes, and
  never creates canonical Topics/Entities. Suggestions are candidates until an
  explicit review/matching layer resolves them.
- **Optional** — with no provider configured, ingestion, admin, and public
  rendering behave exactly as before.

Enrichment is triggered **manually** by a mutating admin from the Article detail
page (no production scheduling). See [`docs/CURRENT_STAGE.md`](docs/CURRENT_STAGE.md),
[`docs/ARCHITECTURE.MD`](docs/ARCHITECTURE.MD) (AI Architecture), and
[`docs/ADMIN.md`](docs/ADMIN.md).

Stage 6 adds one migration (`0014`) that extends the existing
`article_enrichments` table in place — no new table.

Public routes (all under the shared portal chrome):

- **`/`** — homepage: Latest, primary-source updates, and topic navigation.
- **`/latest`** — chronological, paginated feed with source and timestamp.
- **`/article/[id]`** — the current factual public unit: original title, source,
  timestamp, safe excerpt, topic, and a prominent outbound link to the original
  publisher (it is never presented as an AI-written Story).
- **`/topic`** and **`/topic/[slug]`** — the controlled taxonomy and its feeds.
- **`/tool`** and **`/tool/[slug]`** — the Entity/Tool foundation (sparse until
  later enrichment stages).
- **`/story/[slug]`** — a real, published Story for the active Publication,
  localisation-aware (see below), and 404s otherwise (no fake Stories).
- **`/search`** — MVP full-text search over Articles using PostgreSQL only.
- **`/about`** and **`/sources`** — coverage, source selection, and attribution
  philosophy; the enabled public sources grouped by authority tier.
- **`/feed.xml`** — a publication-aware Atom feed (that Publication's domain,
  PUBLISHED Story selection, editorial copy, and default-locale metadata).

**Publication resolution** is `hostname → PublicationDomain → Publication →
public config`, with a sensible in-code default Publication so the portal renders
before any Publication is configured — no hardcoded production domain or locale.
Titles, descriptions, canonical URLs, Open Graph, robots, the sitemap, and the
feed are all publication-aware and derived from the request host.

**Multi-publication localisation (Stage 5B):** authorized admins manage
Publications, their domains (globally unique, one primary each), the
PublicationStories that publish a canonical Story with per-Publication
presentation, and the StoryLocalization rows that carry locale variants
(manual/editorial + import; no automated translation yet) — all audited. The
public Story route resolves a deterministic, publication-controlled locale (a
valid `?locale=` else `default_locale`; never `Accept-Language`) and renders an
approved localisation, else the default-locale localisation, else the
Publication's own canonical publication copy — scoped so nothing leaks across
Publications. `<html lang>`, OG locale, per-Publication canonical URLs, and
same-origin hreflang alternates follow the rendered locale. See
[`docs/PUBLIC_PORTAL.md`](docs/PUBLIC_PORTAL.md).

**Safety & attribution:** all feed-derived content is treated as untrusted and
rendered as escaped text (never raw HTML); outbound URLs are validated before
becoming links; and every item preserves its source name, original timestamp, and
canonical URL with clear outbound access. No internal hashes, DB errors, admin
metadata, or secrets are exposed publicly.

The Stage 3 ingestion pipeline and Stage 4 admin are unchanged:

```text
Source → fetch → parse → normalize → canonicalize URL
       → exact deduplication → Article persistence → SourceFetch audit
       → Source health
```

The following remain **intentionally not implemented yet** and must not be added
without moving to the appropriate roadmap stage:

- GitHub / Hacker News / RSSHub-specific ingestion; arbitrary scraping
- AI **summaries** / editorial Story copy; automatic promotion of AI output into
  canonical Story/editorial fields
- **automated AI translation** (Stage 5B localisation is manual/editorial +
  import only)
- Story **ranking, trending**, recommendation, personalization (Stage 8+)
- automated publishing; production clustering/polling **scheduling**

Public page rendering reads from PostgreSQL (the authoritative store) and does
**not** depend on any live AI call. The `/admin` surface remains the only
publicly-writable-gated UI, and it is not publicly writable.

Scope is governed by [`docs/CURRENT_STAGE.md`](docs/CURRENT_STAGE.md) and
[`docs/ROADMAP.md`](docs/ROADMAP.md). Do not implement later stages without
explicit instruction.

## Tech stack

| Concern    | Choice                                        |
| ---------- | --------------------------------------------- |
| Framework  | Next.js (App Router) + React                  |
| Language   | TypeScript (strict)                           |
| Styling    | Tailwind CSS                                  |
| Linting    | ESLint (flat config) + `eslint-config-next`   |
| Formatting | Prettier                                      |
| Testing    | Vitest + Testing Library (jsdom)              |
| Env safety | Zod runtime validation (`src/config/env.ts`)  |
| Database   | PostgreSQL / Supabase + pgvector (clustering) |
| DB access  | `pg` behind a repository layer (`src/domain`) |

## Requirements

- **Node.js 22** (see [`.nvmrc`](.nvmrc); Node 20.9+ is required by Next.js 16).
- **npm** (the repository uses `package-lock.json`).
- **PostgreSQL 15+ with the `pgvector` extension available** for the database
  commands (migrations/seed/tests). Supabase provides both out of the box. For a
  purely local database, the `pgvector/pgvector` Docker image is the simplest
  option:

  ```bash
  docker run --name vibecoding-db -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=vibecoding -p 5432:5432 -d pgvector/pgvector:pg16
  ```

  The application itself builds and boots without a database; only the `db:*`
  commands require one.

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your local environment file
cp .env.example .env.local

# 3. Validate the environment
npm run env:check

# 4. (Optional) Point DATABASE_URL at your database, then initialise it
#    (runs migrations, seeds the controlled taxonomy, and validates the schema)
npm run db:setup

# 5. Start the dev server
npm run dev
```

The app runs at <http://localhost:3000>.

## Environment

Environment variables are declared, validated, and typed in
[`src/config/env.ts`](src/config/env.ts) using Zod. Application code should
import the validated `appEnv` object rather than reading `process.env`
directly.

- Copy [`.env.example`](.env.example) to `.env.local` and adjust values.
- **Never commit secrets.** All `.env*` files except `.env.example` are
  gitignored.
- Supported deployment targets: **local**, **preview**, **production** (via the
  `APP_ENV` variable, which is distinct from `NODE_ENV`).
- `DATABASE_URL` (and optionally `DIRECT_URL`) configure the PostgreSQL/Supabase
  connection. They are optional for building and running the app, but required
  for the `db:*` commands and database integration tests.
- **AI enrichment (Stage 6)** is optional and server-only: `AI_PROVIDER`
  (`fake` | `anthropic`), and for the live provider `AI_API_KEY` + `AI_MODEL`
  (plus optional `AI_BASE_URL`). With none set, ingestion, admin, and public
  rendering behave exactly as before and the admin enrichment trigger is hidden.
  Keys are never exposed to the browser or placed in a prompt.
- **Story clustering (Stage 7)** uses `EMBEDDING_PROVIDER` — only the
  deterministic `fake` provider today (offline, no key). Unset defaults to `fake`,
  so clustering needs no live embeddings API and nothing else is affected.

## Database

The canonical data model lives in PostgreSQL (Supabase in production). Access
goes through a lightweight repository layer in [`src/domain`](src/domain); UI and
route code must not query the database directly.

### Migrations

Migrations are plain, ordered `.sql` files in
[`src/db/migrations`](src/db/migrations), applied by a small dependency-free
runner ([`src/db/migrate.ts`](src/db/migrate.ts)). Each file runs in its own
transaction and is recorded in a `schema_migrations` table, so re-running is
idempotent and the schema is fully reproducible from source — no external CLI
required.

```bash
npm run db:migrate    # apply pending migrations
npm run db:seed       # seed the controlled top-level Topic taxonomy (idempotent)
npm run db:validate   # assert the database is reachable and complete
npm run db:setup      # migrate + seed + validate, in order
```

Add schema changes only by adding a new numbered migration file — never by
editing an already-applied one.

### Seed data

Seeds are limited to genuinely controlled reference data. Currently that is the
twelve controlled top-level Topics (defined in
[`src/domain/topics.ts`](src/domain/topics.ts)). Seeding never overwrites
existing rows.

### pgvector

The `vector` extension is enabled by the first migration to prepare for future
semantic search and clustering. Embedding tables exist but **no embeddings are
generated in this stage**.

## Scripts

| Script                 | Purpose                                  |
| ---------------------- | ---------------------------------------- |
| `npm run dev`          | Start the development server             |
| `npm run build`        | Production build                         |
| `npm run start`        | Serve the production build               |
| `npm run typecheck`    | Strict TypeScript check (`tsc --noEmit`) |
| `npm run lint`         | ESLint                                   |
| `npm run lint:fix`     | ESLint with autofix                      |
| `npm run format`       | Format with Prettier                     |
| `npm run format:check` | Verify formatting                        |
| `npm test`             | Run the Vitest suite once                |
| `npm run test:watch`   | Run Vitest in watch mode                 |
| `npm run env:check`    | Validate environment variables           |
| `npm run db:migrate`   | Apply pending database migrations        |
| `npm run db:seed`      | Seed controlled reference data           |
| `npm run db:validate`  | Validate database connectivity + schema  |
| `npm run db:setup`     | Migrate, seed, and validate in one step  |
| `npm run ingest`       | Manual/CLI ingestion (see below)         |
| `npm run admin:hash`   | Generate a scrypt hash for an admin user |

## Ingestion

The Stage 3 ingestion engine turns a Source into deduplicated Articles with a
full audit trail. Run it against specific Sources with the CLI (requires
`DATABASE_URL`):

```bash
npm run ingest -- --register           # upsert the representative Source registry
npm run ingest -- --list               # list configured Sources and their health
npm run ingest -- --source <slug>      # ingest one Source by slug
npm run ingest -- --all                # ingest every enabled Source
```

The pipeline (`src/ingestion`) fetches safely (timeout, bounded redirects,
conditional requests, response-size cap, SSRF protection), parses RSS/Atom into
one canonical item shape, canonicalizes and hashes item URLs for exact
deduplication, persists Articles through the repository layer, records every
attempt in `source_fetches`, and updates each Source's health. External feeds are
treated as untrusted input throughout.

Feed-behaviour edge cases (redirect/tracking URLs, malformed feeds, timeouts,
SSRF) are covered by stored fixtures in `tests/ingestion`. Optional live
validation of the representative registry feeds is opt-in and kept out of normal
CI:

```bash
INGEST_LIVE_SMOKE=1 npx vitest run tests/ingestion/live-smoke.test.ts
```

## Admin

The admin control plane is served at `/admin` by the same application. It
requires `DATABASE_URL` plus two admin variables; without them the app still
builds and `/admin/login` shows a "not configured" notice.

```bash
# 1. Hash a password (plaintext is never stored or committed):
npm run admin:hash -- 'your-password'

# 2. Configure the environment (e.g. in .env.local):
ADMIN_SESSION_SECRET=$(openssl rand -hex 32)
ADMIN_USERS=[{"username":"alice","passwordHash":"scrypt:...","role":"ADMIN"}]

# 3. Run the app and sign in at http://localhost:3000/admin
npm run dev
```

Roles are `ADMIN`/`EDITOR` (may mutate) and `VIEWER` (read-only); authorization
is enforced server-side on every mutation, and every mutation is recorded in
`admin_audit_log`. Manual ingestion triggered from a Source page reuses the
Stage 3 safe fetcher unchanged. **Stage 5B** adds `/admin/publications` for
managing Publications, their domains, PublicationStories, and StoryLocalizations
(all audited). Full details, including the security model, are in
[`docs/ADMIN.md`](docs/ADMIN.md).

## Testing

Tests use **Vitest** with a **jsdom** environment and Testing Library. Test
files live in `tests/` (and co-located `*.test.ts[x]` files are also picked up).

```bash
npm test
```

Domain, environment, migration-integrity, publication-resolution, visibility,
metadata, formatting, and safe-rendering tests run with no external
dependencies. The database **integration** tests (schema, admin services, and
the public content/query reads in
[`tests/public/content.integration.test.ts`](tests/public/content.integration.test.ts))
are **skipped automatically unless `DATABASE_URL` is set**, so CI stays green
without a database while local/dev runs get full coverage. Each integration test
runs inside a transaction that is always rolled back, leaving the database
untouched. To run them:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/vibecoding npm test
```

## Build

```bash
npm run build
```

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull
request and on pushes to `main`. It executes, in order: install, environment
validation, typecheck, lint, format check, tests, and production build. CI must
not be made green by disabling checks.

## Project structure

```text
src/
  app/           Next.js App Router (layout, routes, global styles)
    (public)/    Stage 5/5B public portal (home, latest, article, topic, tool,
                 story, search, about, sources) + shared chrome/components
    admin/       Stage 4 admin + Stage 5B /admin/publications
    feed.xml/    Publication-aware Atom feed route
    sitemap.ts   Publication-aware sitemap (incl. published Stories)
    robots.ts    Publication-aware robots directives
  config/        Environment validation and typed configuration
  db/            Connection pool, migration runner, seed, validation
    migrations/  Ordered .sql migration files (source of truth for the schema)
  domain/        Controlled vocabularies, row types, and repositories
    repositories/  Data-access boundary (Source/Article/Story/Entity/Topic/
                   Publication/public reads)
  lib/           Shared framework-agnostic helpers (e.g. safe-url)
  public/        Public-portal application layer (publication resolution,
                 metadata, content composition, formatting)
  ingestion/     Stage 3 ingestion engine
    adapters/    Source Adapter contract + RSS/Atom adapter
    http/        Safe fetcher, SSRF guard, error classification
    normalize/   URL canonicalization, hashing, item normalization
    health.ts    Deterministic Source-health derivation
    ingest.ts    Pipeline orchestrator
    registry.ts  Representative Source registry
scripts/         Standalone maintenance scripts (env validation, ingestion CLI)
tests/           Vitest test suites (domain, db, config, app, ingestion)
docs/            Product, architecture, data-model, and roadmap docs
.github/         CI workflows
```

The remaining architectural seams (`ai/`, `inngest/`, `components/`) are defined
in [`docs/ARCHITECTURE.MD`](docs/ARCHITECTURE.MD) and will be introduced **when
the corresponding roadmap stage requires them**. Following the project rule,
empty folders are not created merely to imitate the target architecture.

## Contributing rules

This project follows strict architectural rules defined in
[`CLAUDE.md`](CLAUDE.md). In particular: keep Article and Story as distinct
domain objects, keep source facts separate from AI-derived data, never let
public rendering depend on live AI calls, prefer a small number of mature
dependencies, and do not implement later roadmap stages early.
