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

**Stage 3 — News Ingestion Engine.**

On top of the Stage 2 foundation (application + canonical PostgreSQL/Supabase
data model), this repository now contains the first reliable news-ingestion
pipeline:

```text
Source → fetch → parse → normalize → canonicalize URL
       → exact deduplication → Article persistence → SourceFetch audit
       → Source health
```

It ships a Source Adapter contract; an RSS/Atom adapter (RSS 2.0, RSS 1.0/RDF,
Atom 1.0); a safe HTTP fetcher (timeout, bounded redirects, conditional
ETag/Last-Modified requests, response-size cap, SSRF protection, retryable-error
classification); deterministic URL canonicalization with tracking-parameter
removal; exact deduplication via canonical-URL hashing and the existing Article
unique constraints; SourceFetch audit records; deterministic Source-health
transitions; and a CLI ingestion entry point (`npm run ingest`). Ingestion
creates/updates **Articles only** — never Stories. See
[`src/ingestion`](src/ingestion).

The following remain **intentionally not implemented yet** and must not be added
without moving to the appropriate roadmap stage:

- GitHub / Hacker News / RSSHub-specific ingestion; arbitrary scraping
- AI enrichment, summaries, entity extraction, embeddings **generation**
- Story clustering, ranking, trending
- the public product UI and multi-publication rendering
- scheduled production polling

The home route (`/`) is a **foundation placeholder**, not the product homepage.
Public page rendering does **not** depend on the database or any live AI call.

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
| Database   | PostgreSQL / Supabase + pgvector (prepared)   |
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
  for the `db:*` commands and database integration tests. AI provider variables
  remain reserved for later stages.

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

## Testing

Tests use **Vitest** with a **jsdom** environment and Testing Library. Test
files live in `tests/` (and co-located `*.test.ts[x]` files are also picked up).

```bash
npm test
```

Domain, environment, and migration-integrity tests run with no external
dependencies. The database **integration** tests
([`tests/db/schema.integration.test.ts`](tests/db/schema.integration.test.ts))
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
  config/        Environment validation and typed configuration
  db/            Connection pool, migration runner, seed, validation
    migrations/  Ordered .sql migration files (source of truth for the schema)
  domain/        Controlled vocabularies, row types, and repositories
    repositories/  Data-access boundary (Source/Article/Story/Entity/Topic)
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
