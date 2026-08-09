# Current Stage

# Stage 2 — Foundation & Data Layer

## Status

**ACTIVE**

This file defines the only implementation scope currently approved.

Do not begin Stage 3.

---

# Goal

Create a clean, reproducible, tested foundation for the Vibe Coding News Portal so Stage 3 can implement real news ingestion without redesigning the repository or canonical data model.

---

# Implement

## 1. Application Foundation

Set up or normalize the repository around:

- Next.js App Router;
- React;
- TypeScript strict mode;
- Tailwind CSS;
- sensible project structure.

Do not build the final public homepage.

## 2. Development Quality

Configure:

- formatting;
- linting;
- typechecking;
- unit/integration test foundation;
- production build scripts.

Prefer a small number of mature dependencies.

## 3. Environment

Support:

- local;
- preview;
- production.

Create safe environment validation and an example environment file.

Never commit secrets.

## 4. PostgreSQL / Supabase Foundation

Establish:

- database connectivity;
- migration workflow;
- reproducible local/development setup;
- seed workflow.

Enable pgvector only if doing so cleanly supports the approved future schema.

Do not generate embeddings.

## 5. Canonical Data Model

Implement the models described in `DATA_MODEL.md`.

Required core structures:

- Publication
- PublicationDomain
- PublicationStory
- StoryLocalization
- Source
- SourceFetch
- Article
- Story
- StoryArticle
- Entity
- EntityAlias
- ArticleEntity
- StoryEntity
- Topic
- ArticleEnrichment
- AdminAuditLog

Embedding tables may be created if appropriate for the chosen migration design, but no embedding generation is allowed.

## 6. Controlled Taxonomy

Seed these Topics:

- News
- Releases
- Tools
- Coding Agents
- Models
- MCP
- Open Source
- Developer Infrastructure
- Tutorials
- Research
- Business
- Community

## 7. Data-Access Boundary

Create a clear, lightweight data-access/repository pattern.

At minimum the design should support:

- Source access;
- Article access;
- Story access;
- Entity access;
- Topic access.

Do not create an elaborate enterprise framework.

## 8. CI

Pull-request validation should run equivalents of:

```text
install
typecheck
lint
tests
production build
```

Do not disable failures to make CI green.

## 9. Documentation

Update the README with:

- project purpose;
- requirements;
- setup;
- environment;
- database initialization;
- migrations;
- seed;
- tests;
- build;
- current stage.

Another coding agent should be able to clone the repository and reproduce the development setup.

---

# Do Not Implement

Stage 2 explicitly excludes:

- multi-domain public rendering;
- publication branding UI;
- translation/localisation workflows;
- publication-specific SEO implementation;
- RSS fetching;
- Atom fetching;
- Hacker News ingestion;
- GitHub ingestion;
- RSSHub ingestion;
- source scheduling;
- feed parsing;
- URL canonicalization logic beyond schema requirements;
- article ingestion workflows;
- AI calls;
- summaries;
- Entity extraction;
- embeddings generation;
- Story clustering;
- ranking;
- Trending logic;
- GitHub trend analysis;
- newsletters;
- comments;
- public user accounts;
- personalization;
- alerts;
- payments;
- production homepage design;
- native/mobile apps.

Architectural seams are allowed. Future functionality is not.

---

# Required Architecture Checks

Before considering Stage 2 complete, verify:

1. Article and Story are separate.
2. Canonical intelligence is separated from Publication-specific presentation.
3. One canonical Story may be published by multiple Publications.
4. One Story can contain multiple Articles.
5. One Article can reference multiple Entities.
6. AI-derived data is separate from source facts.
7. Source fetch history can be audited.
8. Source authority and Source health are representable.
9. Topics are controlled.
10. future Story clustering is supported by relationships.
11. no canonical logic assumes a single domain, brand, or locale.
12. database changes are reproducible through migrations.
13. the application can function later even if AI is unavailable.

---

# Required Validation

Before completion run all applicable checks:

- install validation;
- typecheck;
- lint;
- tests;
- production build;
- migration validation;
- seed validation.

Review your own Git diff after tests.

Look for:

- schema drift;
- unnecessary dependencies;
- unused files;
- naming inconsistency;
- unsafe cascading deletes;
- missing constraints;
- missing indexes;
- TypeScript escapes;
- leaked environment values;
- scope creep.

Correct issues before reporting completion.

---

# Exit Criteria

Stage 2 is complete only when:

## Foundation

- application starts locally;
- production build succeeds;
- strict TypeScript passes;
- lint passes;
- tests pass.

## Database

- migrations reproduce the schema;
- database connection works;
- seed works;
- required constraints and important indexes exist.

## Domain

Required canonical models and relationships exist.

## Architecture

- Article and Story remain distinct;
- source facts and derived data remain distinct;
- data access is not scattered through UI components;
- future source adapters can be added without redesigning the canonical model;
- future Publications, domains, and locales can be added without duplicating the ingestion/intelligence data model.

## Operations

- secrets are not committed;
- CI exists;
- setup is documented;
- another developer or coding agent can reproduce the environment.

---

# Completion Report

When all exit criteria pass, report:

1. what was implemented;
2. major database tables and relationships;
3. tests and validation results;
4. architectural deviations, if any;
5. unresolved risks/issues;
6. whether every Stage 2 exit criterion passed;
7. whether the repository is ready for Stage 3.

Then stop.

# HARD STOP

Do not begin Stage 3 without explicit approval.
