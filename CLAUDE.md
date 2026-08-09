# CLAUDE.md

## Project

This repository contains the **Vibe Coding News Portal**: an AI-enriched news aggregation and intelligence platform focused on vibe coding, AI coding tools, coding agents, MCP, developer tooling, important model developments, GitHub activity, releases, and developer-community signals.

The product is **not** a generic AI news site and **not** a personal RSS reader.

## Operating Rule

Before making significant changes, read:

- `docs/PRODUCT.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/ROADMAP.md`
- `docs/CURRENT_STAGE.md`

`docs/CURRENT_STAGE.md` defines what may be implemented now.

Do not implement later roadmap stages unless explicitly instructed.

## Permanent Architecture Rules

1. Use a **TypeScript modular monolith**.
2. Primary stack:
   - Next.js
   - React
   - TypeScript
   - PostgreSQL / Supabase
   - pgvector when semantic search or clustering is implemented
   - Inngest for durable background jobs
   - Vercel for application hosting
3. PostgreSQL is the authoritative source of truth.
4. **Article and Story are different domain objects.**
   - Article = one item published by one Source.
   - Story = one real-world event that may contain many Articles.
5. Source facts must remain separate from AI-derived data.
6. AI must never silently overwrite source-supplied facts.
7. Public page rendering must not depend on live AI calls.
8. Keep database access behind clear data-access/domain boundaries.
9. Prefer mature, minimal dependencies.
10. Do not introduce microservices, Redis, Kafka, RabbitMQ, Elasticsearch, a second database, or another backend language without explicit approval.
11. Do not create infrastructure because a future stage may need it.
12. Human/editorial overrides must remain possible.
13. The portal is a discovery and intelligence layer, not a republishing engine. Preserve attribution, canonical source URLs, publication provenance, and clear outbound access to original reporting. Do not publicly reproduce full copyrighted articles without permission or an appropriate licence.
14. The platform is **multi-publication by design**. One canonical intelligence backend may power multiple websites, domains, brands, and languages.
15. Canonical intelligence is global; publishing is publication-specific.
16. A Publication may choose different Stories, headlines, summaries, slugs, languages, editorial priorities, and branding without duplicating underlying Article/Story facts.
17. Do not hardcode a single domain, locale, brand, or publication into canonical domain logic.
18. Multiple English publications must not be implemented as near-identical content clones; each Publication should have a distinct editorial position or audience.

## Canonical Domain Vocabulary

Use these terms consistently:

- Source
- SourceFetch
- Article
- Story
- Entity
- Topic
- Signal *(future domain concept)*
- Release *(future domain concept)*

Do not casually interchange `post`, `item`, `news`, `article`, and `story`.

## Engineering Rules

- TypeScript strict mode.
- Avoid `any` unless unavoidable and documented.
- Validate runtime input.
- Use migrations for schema changes.
- Never commit secrets.
- Store timestamps in UTC.
- Write tests for deterministic domain logic.
- Keep workers idempotent.
- Treat external HTML, URLs, APIs, feeds, and AI output as untrusted input.
- Review foreign-key deletion behavior deliberately.
- Preserve provenance and auditability.

## Coding-Agent Workflow

For every substantial task:

1. inspect the repository and Git status;
2. read the relevant project docs;
3. implement only the current scope;
4. run relevant tests;
5. inspect failures;
6. correct them;
7. review your own diff;
8. compare the result against architecture and data-model rules;
9. remove unnecessary complexity and dependencies;
10. stop when current-stage exit criteria are satisfied.

## Prohibited Autonomous Changes

Do not independently:

- change the primary framework;
- change the database;
- create new top-level domain concepts;
- collapse Article into Story;
- modify the controlled top-level taxonomy;
- add microservices;
- add a new queueing platform;
- add a dedicated search engine;
- expose service credentials;
- build deferred roadmap stages.

Architectural changes require explicit approval.

## Completion Standard

Do not declare work complete if:

- typecheck fails;
- lint fails;
- tests fail;
- production build fails;
- migrations are incomplete;
- documentation disagrees with implementation;
- future-stage scope was implemented accidentally.

When a stage is complete, report what changed, tests run, deviations, unresolved risks, and whether exit criteria passed. Then stop.
