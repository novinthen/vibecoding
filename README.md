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

**Stage 2A — Project Foundation.**

This repository currently contains only the reproducible, tested application
foundation. The following are **intentionally not implemented yet** and must not
be added without moving to the appropriate roadmap stage:

- database schema / migrations / seed
- ingestion (RSS, Atom, GitHub, Hacker News, RSSHub, feeds)
- AI enrichment, summaries, entity extraction, embeddings
- Story clustering, ranking, trending
- the public product UI and multi-publication rendering

The home route (`/`) is a **foundation placeholder**, not the product homepage.

Scope is governed by [`docs/CURRENT_STAGE.md`](docs/CURRENT_STAGE.md) and
[`docs/ROADMAP.md`](docs/ROADMAP.md). Do not implement later stages without
explicit instruction.

## Tech stack

| Concern    | Choice                                       |
| ---------- | -------------------------------------------- |
| Framework  | Next.js (App Router) + React                 |
| Language   | TypeScript (strict)                          |
| Styling    | Tailwind CSS                                 |
| Linting    | ESLint (flat config) + `eslint-config-next`  |
| Formatting | Prettier                                     |
| Testing    | Vitest + Testing Library (jsdom)             |
| Env safety | Zod runtime validation (`src/config/env.ts`) |

## Requirements

- **Node.js 22** (see [`.nvmrc`](.nvmrc); Node 20+ is supported).
- **npm** (the repository uses `package-lock.json`).

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your local environment file
cp .env.example .env.local

# 3. Validate the environment
npm run env:check

# 4. Start the dev server
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
- Stage 2A requires no secrets; every variable has a safe default. Database and
  AI provider variables are reserved for later stages.

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

## Testing

Tests use **Vitest** with a **jsdom** environment and Testing Library. Test
files live in `tests/` (and co-located `*.test.ts[x]` files are also picked up).

```bash
npm test
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
scripts/         Standalone maintenance scripts (e.g. env validation)
tests/           Vitest test suites
docs/            Product, architecture, data-model, and roadmap docs
.github/         CI workflows
```

Additional architectural seams (`domain/`, `ingestion/`, `ai/`, `db/`,
`inngest/`, `components/`) are defined in
[`docs/ARCHITECTURE.MD`](docs/ARCHITECTURE.MD) and will be introduced **when the
corresponding roadmap stage requires them**. Following the project rule, empty
folders are not created merely to imitate the target architecture.

## Contributing rules

This project follows strict architectural rules defined in
[`CLAUDE.md`](CLAUDE.md). In particular: keep Article and Story as distinct
domain objects, keep source facts separate from AI-derived data, never let
public rendering depend on live AI calls, prefer a small number of mature
dependencies, and do not implement later roadmap stages early.
