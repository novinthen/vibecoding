# System Architecture

## Architectural Style

Use a **TypeScript modular monolith**.

One primary repository contains:

- multi-publication public Next.js application;
- administrator surface;
- API routes;
- domain services;
- ingestion modules;
- AI modules;
- ranking/search modules;
- durable background functions;
- shared types;
- database access.

Do not split the MVP into microservices.

## Approved Stack

### Application
- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui where useful

### Data
- PostgreSQL via Supabase
- pgvector when embeddings are implemented

### Background Jobs
- Inngest

### Hosting
- Vercel

### Edge / DNS / Security
- Cloudflare when required

### Testing
- Vitest
- Playwright for end-to-end flows

### Observability
- structured logging
- Sentry or equivalent when introduced

## High-Level Flow

```text
Sources
   ↓
Source Adapters
   ↓
Fetcher
   ↓
Normalizer
   ↓
Canonical URL / Exact Deduplication
   ↓
Article Store
   ↓
AI Enrichment
   ↓
Story Candidate Matching
   ↓
Story Clustering
   ↓
Story Store
   ↓
Ranking
   ↓
Latest / Trending / Important
   ↓
Next.js Public Portal
```

## Source Acquisition Strategy

Preferred order:

1. RSS / Atom
2. official APIs
3. GitHub
4. Hacker News
5. RSSHub compatibility
6. direct integrations where strategically justified

Arbitrary scraping is deferred.

Each acquisition method must eventually produce the same normalized Article input shape.

## Source Adapter Boundary

Conceptual adapter contract:

```text
validate()
fetch()
normalize()
healthCheck()
```

The rest of the application should not care whether an item came from RSS, GitHub, Hacker News, or RSSHub.

## Multi-Publication Architecture

The system must support multiple domains and languages without duplicating the ingestion/intelligence backend.

```text
Sources
   ↓
Articles
   ↓
Stories
   ↓
Canonical Intelligence
   ↓
Publication Selection / Localisation
   ↓
Domain-specific rendering
```

A request should eventually resolve `hostname → PublicationDomain → Publication → locale/brand/editorial settings → PublicationStory/StoryLocalization → render`.

Do not hardcode the application around one hostname or locale. The same Story may be published, omitted, translated, editorially adapted, or featured differently by different Publications while canonical Story facts remain shared.

## Key Architectural Boundary

Never design:

```text
Source → HTML Card
```

Design:

```text
Source
  ↓
Article
  ↓
Story
  ↓
Ranking
  ↓
Presentation
```

This keeps ingestion, intelligence, and UI independent.

## Data Authority

PostgreSQL is authoritative.

Do not store authoritative application state in:

- Redis;
- browser storage;
- queue state;
- AI-provider state.

## AI Architecture

AI is an enrichment layer.

AI may later:

- classify relevance;
- extract Entities;
- assign Topics;
- summarize;
- explain why a development matters;
- produce embeddings;
- suggest Story matches.

AI must not:

- invent sources;
- overwrite source-supplied facts;
- control database permissions;
- create top-level Topics automatically;
- become required for normal page rendering.

Use a provider abstraction so domain code depends on capabilities, not one vendor.

## Background Jobs

Inngest will later handle durable, retryable workflows such as:

- scheduled source refresh;
- enrichment;
- clustering;
- ranking refresh;
- health evaluation.

Workers must be idempotent.

Do not introduce Redis-based queues during MVP without explicit approval.

## Search

Start with PostgreSQL full-text search.

Use pgvector later for semantic:

- related-story search;
- cluster candidate retrieval;
- semantic search.

Do not introduce Elasticsearch, Typesense, or Meilisearch until measurements justify it.

## Admin Architecture

The admin surface belongs inside the same Next.js application.

Future administrator roles:

- ADMIN
- EDITOR
- VIEWER

Editorial actions should be auditable.

## Security Boundaries

Treat as untrusted:

- feeds;
- HTML;
- URLs;
- third-party APIs;
- AI output;
- administrator input.

Required controls as relevant:

- runtime validation;
- HTML sanitization;
- SSRF protection for fetchers;
- server-side secrets;
- authorization;
- parameterized/safe database access;
- rate limiting;
- prompt-injection boundaries.

## Repository Structure

Prefer a structure similar to:

```text
src/
  app/
  components/
  domain/
  ingestion/
  ai/
  inngest/
  db/
  lib/
  config/
  types/

tests/
scripts/
docs/
```

Do not create empty folders merely to imitate architecture.

## Dependency Philosophy

Prefer a small number of mature dependencies.

Before adding a dependency ask:

1. Is it necessary?
2. Is it maintained?
3. Can the platform or standard library already solve this?
4. Does it introduce unnecessary lock-in?
5. Does it materially simplify a current-stage requirement?

## Deployment Principle

Target environments:

- local;
- preview;
- production.

Production should eventually resemble:

```text
Multiple Domains
      ↓
Cloudflare
      ↓
Vercel / Next.js
      ↓
Hostname → Publication resolution
      ↓
Supabase / PostgreSQL
   ↘
    Inngest background workflows
```

## Architectural Non-Goals

Do not introduce during MVP without explicit approval:

- microservices;
- Kubernetes;
- Kafka;
- RabbitMQ;
- Redis as a required core dependency;
- a second primary database;
- a separate backend application;
- a second backend language;
- Elasticsearch;
- arbitrary crawler infrastructure.
