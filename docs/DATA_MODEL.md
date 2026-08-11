# Canonical Data Model

## Most Important Rule

**Article and Story are different.**

**Ranking and Clustering are separate.**

### Article
One item published by one Source.

Examples:
- an Anthropic blog announcement;
- a TechCrunch report;
- a GitHub release;
- a Hacker News submission.

### Story
One real-world event or development that may contain multiple Articles.

Example:

> Anthropic launches a new Claude Code capability.

The official announcement, independent coverage, and community reaction may all belong to the same Story.

### Ranking
A derived score that answers "Which Stories matter most right now?" Ranking operates on formed Stories and never alters their membership.

Never collapse these concepts.

---

# Core Relationships

```text
Source
  └── SourceFetch
  └── Article
        ├── ArticleEnrichment
        ├── ArticleEmbedding
        ├── ArticleEntity ── Entity
        └── StoryArticle ── Story
                              ├── StoryEntity ── Entity
                              ├── StoryEmbedding
                              ├── Topic
                              └── PublicationStory ── Publication
                                                     ├── PublicationDomain
                                                     └── StoryLocalization

Entity
  └── EntityAlias

AdminAuditLog records editorial/admin changes.
```

---

# Publication

Represents one public editorial brand/site. Recommended fields: `id`, `name`, `slug`, `default_locale`, `timezone`, `status`, `editorial_profile`, `branding`, `seo_settings`, `created_at`, `updated_at`. A Publication is not merely a language.

## PublicationDomain

Maps hostnames to Publications. Recommended fields: `id`, `publication_id`, `domain`, `is_primary`, `enabled`, `created_at`. Domain must be unique.

## PublicationStory

Controls whether and how a canonical Story is published by one Publication. Recommended fields: `publication_id`, `story_id`, `status`, `slug`, `headline`, `published_summary`, `published_why_it_matters`, `featured`, `editorial_priority`, `published_at`, `created_at`, `updated_at`. Prevent duplicate Publication–Story relationships.

## StoryLocalization

Stores language/localisation variants of a **published** Story. A localisation belongs to a `PublicationStory` (the publishing hierarchy is Story → PublicationStory → StoryLocalization): a Story must first be selected/configured for a Publication before publication-specific localisation can exist. It therefore references `publication_story_id` rather than repeating `publication_id` + `story_id`, which removes a transitive dependency and makes an orphan (or parent-mismatched) localisation structurally impossible. Recommended fields: `id`, `publication_story_id`, `locale`, `headline`, `summary`, `why_it_matters`, `translation_source`, `model_provider`, `model_name`, `status`, `reviewed_by`, `created_at`, `updated_at`. Enforce one localisation per (`publication_story_id`, `locale`) and cascade deletes from `PublicationStory`. Do not model languages as `title_en`, `title_ms`, etc.

---

# Source

Represents a publisher or acquisition endpoint.

Recommended fields:

- id
- name
- slug
- homepage_url
- feed_url / endpoint
- source_type
- authority_tier
- poll_interval
- enabled
- language
- default_topic_id where useful
- last_fetch_at
- last_success_at
- failure_count
- health_status
- created_at
- updated_at

## Source Type

Support at minimum:

- RSS
- ATOM
- GITHUB
- HACKER_NEWS
- RSSHUB
- API
- MANUAL

## Authority Tier

Controlled editorial values:

- PRIMARY
- TRUSTED
- SPECIALIST
- COMMUNITY
- DISCOVERY

## Health Status

- HEALTHY
- DEGRADED
- FAILING
- DISABLED
- UNKNOWN

---

# SourceFetch

Operational audit record for each fetch attempt.

Recommended fields:

- id
- source_id
- started_at
- completed_at
- status
- http_status
- items_found
- items_new
- items_updated
- duration_ms
- error_code
- error_message
- metadata
- created_at

This supports source-health analysis and debugging.

---

# Article

Canonical record of a publisher item.

Recommended fields:

- id
- source_id
- external_id
- url
- canonical_url
- url_hash
- original_title
- normalized_title
- original_excerpt
- clean_text
- author
- published_at
- source_updated_at
- discovered_at
- image_url
- language
- content_hash
- status
- created_at
- updated_at

## Provenance Rule

Preserve source-supplied fields.

Do not overwrite original fields with AI-derived content.

## Article Status

Future-compatible lifecycle:

- DISCOVERED
- NORMALIZED
- DUPLICATE
- QUEUED
- ENRICHED
- CLUSTERED
- PUBLISHED
- HIDDEN
- FAILED

---

# Story

Represents a real-world event.

`summary` and `why_it_matters` on Story are **canonical editorial projection fields**. Raw AI output must first live in a versioned enrichment record. Promotion into the canonical Story projection should occur only through an explicit validation/editorial workflow.

```text
Source facts
   ↓
Article
   ↓
Versioned AI/derived enrichment
   ↓
validation / editorial selection
   ↓
published Story projection
```

Recommended fields:

- id
- slug
- canonical_title
- summary
- why_it_matters
- primary_topic_id
- status
- first_published_at
- last_activity_at
- primary_article_id
- importance_score
- trending_score
- confidence
- created_at
- updated_at

`summary` and `why_it_matters` are derived canonical editorial fields. They must not replace Article source facts, and AI workers must not silently overwrite them directly.

## Story Status

- DRAFT
- ACTIVE
- MERGED
- SUPPRESSED
- ARCHIVED

A merged Story should remain traceable.

## Stage 7 clustering additions (migration `0015`)

Clustering extends Story **in place** with review/provenance columns (it does not
redesign the canonical model):

- `review_state` — `UNREVIEWED` (default for an automatically formed Story) |
  `REVIEWED` | `LOCKED`. REVIEWED/LOCKED Stories are **protected**: the clustering
  engine never autonomously changes their membership; only explicit, audited admin
  operations may. This is the false-merge / silent-split guard.
- `formation_source` — `AUTOMATIC` (engine) | `MANUAL` (editor).
- `clustering_method`, `clustering_version` — method/formula version that formed
  the Story (reproducibility across upgrades).

A newly clustered Story starts `DRAFT` + `UNREVIEWED` (an internal, reviewable
state). Clustering never publishes; `canonical_title` is a **provisional**,
evidence-based value seeded from the primary Article, with full provenance in
`clustering_decisions`.

---

# StoryArticle

Many-to-many relationship between Stories and Articles.

Recommended fields:

- story_id
- article_id
- relationship_type
- confidence
- assignment_source
- created_at

Relationship types should support:

- PRIMARY
- SUPPORTING
- OFFICIAL
- REACTION
- COMMENTARY
- RELATED

Prevent duplicate Story–Article relationships.

### Stage 7 provenance (migration `0015`)

Each membership additionally records the DERIVED clustering evidence that placed
the Article: `clustering_method`, `clustering_version`, `score`, `decision_reason`,
and `signals` (JSONB signal breakdown). `assignment_source` distinguishes
`AUTOMATIC` from `MANUAL`. These annotate the link; they never touch Article
source facts. The `(story_id, article_id)` primary key means an Article is never
linked to the same Story twice (idempotent attach).

---

# Entity

Persistent object users may browse or follow.

## Entity Types

- COMPANY
- PRODUCT
- MODEL
- PROTOCOL
- REPOSITORY
- PERSON
- ORGANIZATION

Recommended fields:

- id
- entity_type
- name
- slug
- description
- homepage_url
- github_url
- logo_url
- status
- created_at
- updated_at

---

# EntityAlias

Maps alternate names to one canonical Entity.

Recommended fields:

- id
- entity_id
- alias
- normalized_alias
- source
- confidence
- created_at

Example:

Canonical Entity:

`Claude Code`

Possible aliases:

- `Claude CLI`
- `claude-code`
- `Anthropic Claude Code`

Do not hardcode aliases in UI logic.

---

# ArticleEntity

Relationship between an Article and an Entity.

Recommended fields:

- article_id
- entity_id
- relationship
- confidence
- source

Future relationship examples:

- SUBJECT
- MENTION
- AUTHOR
- CREATOR
- ACQUIRER
- PARTNER
- COMPETITOR

---

# StoryEntity

Persistent relationship between Story and Entity.

Recommended fields:

- story_id
- entity_id
- relationship
- importance
- confidence

Do not require every Story page to recompute Entities from Articles.

---

# Topic

Controlled taxonomy.

Recommended fields:

- id
- name
- slug
- description
- parent_id
- enabled
- created_at
- updated_at

Seed these top-level Topics:

1. News
2. Releases
3. Tools
4. Coding Agents
5. Models
6. MCP
7. Open Source
8. Developer Infrastructure
9. Tutorials
10. Research
11. Business
12. Community

Top-level Topics are editorially controlled.

---

# ArticleEnrichment

Stores derived AI output separately from Article source facts.

Base fields:

- id
- article_id
- model_provider
- model_name
- prompt_name
- prompt_version
- summary
- why_it_matters
- relevance_score
- importance_score
- technical_depth
- novelty_score
- confidence
- structured_output
- created_at

## Stage 6 versioning & provenance additions (migration `0014`)

Stage 6 extends this table **in place** (no new table) so each model/prompt run
is an immutable, versioned attempt:

- `enrichment_version` — monotonic per-Article version; re-running creates a new
  version and never overwrites a prior one. `UNIQUE (article_id,
  enrichment_version)`.
- `schema_version` — output-schema version the row was validated against.
- `status` — `SUCCEEDED` | `INVALID_OUTPUT` | `PROVIDER_ERROR`. Every attempt,
  including failures, is recorded.
- `relevance` — advisory classification `RELEVANT` | `MAYBE_RELEVANT` |
  `IRRELEVANT` | `UNCLASSIFIED` (UNCLASSIFIED is system-assigned on failure).
- `relevance_reason` — short justification.
- `suggested_topics`, `suggested_entities` (JSONB) — advisory candidates only;
  never canonical. A separate deterministic matching layer resolves them.
- `usage` (JSONB) — token/cost metadata when the provider reports it.
- `generated_at` — when the provider produced the output.
- `validation_error` — set when `status = INVALID_OUTPUT`.
- `error_code`, `error_message` — set when `status = PROVIDER_ERROR` (classified
  retryable/non-retryable).

This design supports reprocessing and auditability. AI output here is
**advisory**: it is never a source fact, is machine-validated before it is
trusted, and is never published or promoted into a canonical Story/editorial
field automatically — promotion is a separate, explicit, approved workflow.

---

# Embeddings

Prefer separate records.

## ArticleEmbedding

- article_id
- model
- dimensions
- embedding
- created_at

## StoryEmbedding

- story_id
- model
- dimensions
- embedding
- created_at

Do not generate embeddings during Stage 2.

Use PostgreSQL/pgvector-compatible storage when implemented.

## Stage 7 embedding provenance (migration `0015`)

Both embedding tables gain `provider`, `embedding_version`, and
`source_content_hash`. Embeddings are DERIVED data with explicit provenance: there
is exactly one CURRENT embedding per `(row, model)` (re-embedding upserts in
place), while every `clustering_decisions` row retains the `embedding_version` it
used, so a later model/version refresh never destroys prior decision provenance.
Candidate nearest-neighbour search is scoped to a single model (equal dimensions)
and bounded by a time window, so exact pgvector `<=>` distance is used with no
approximate index.

---

# ClusteringDecision (migration `0015`)

Append-only, auditable log of every clustering attempt for an Article — the
reviewable provenance surface. One row per attempt records what was decided and
why, and never mutates a prior row.

Fields:

- id
- article_id (FK, CASCADE)
- story_id (FK, SET NULL — the log survives Story deletion)
- method, method_version
- embedding_provider, embedding_model, embedding_version
- decision — `CREATED_STORY` | `ASSIGNED_EXISTING` | `AMBIGUOUS` |
  `SKIPPED_EXISTING` | `SKIPPED_PROTECTED`
- decision_source — `AUTOMATIC` | `MANUAL`
- top_score, confidence, candidate_count
- reason
- candidates (JSONB) — the full scored candidate set considered
- signals (JSONB) — winning signal breakdown
- created_at

A new Story is always formed when there is no confident match, so "no candidates"
/ "below threshold" are recorded in `reason`, not as separate outcomes.

---

# AdminAuditLog

Tracks important editorial and administrative actions.

Recommended fields:

- id
- actor_id / actor_identifier
- action
- target_type
- target_id
- before
- after
- metadata
- created_at

Later audit examples:

- Story merge;
- Story split;
- summary correction;
- source authority change;
- source disable;
- Entity alias change;
- editorial boost.

---

# Future Domain Concepts

`Signal` and `Release` are approved future concepts, but they are **not Stage 2 canonical-table requirements**.

- **Signal** will later represent external momentum or relevance indicators such as Hacker News activity, GitHub star velocity, coverage velocity, and community engagement.
- **Release** will later represent structured product/software release events.

Their schemas should be designed when the ranking and developer-intelligence stages provide concrete requirements rather than prematurely during Stage 2.

---

# Database Conventions

- Prefer UUID-style identifiers.
- Store timestamps in UTC.
- Use migrations for all schema changes.
- Add constraints for true domain invariants.
- Index known access paths rather than every column.
- Review cascade behavior deliberately.
- Preserve historical/audit records where possible.
- Use JSON/JSONB for flexible metadata only when relational structure is not warranted.

## Important Index Candidates

Consider indexes for:

- Publication.slug
- PublicationDomain.domain
- PublicationStory publication_id + story_id
- StoryLocalization publication_story_id + locale
- Source.slug
- Source enabled/health
- Article canonical URL/hash
- Article source + external_id
- Article published_at
- Article status
- Story.slug
- Story status
- Story last_activity_at
- Entity.slug
- EntityAlias.normalized_alias
- Topic.slug
- relationship foreign keys

Do not treat this list as permission to index every field.

---

# Future Article Processing Lifecycle

Later stages should support:

```text
DISCOVERED
   ↓
NORMALIZED
   ↓
EXACT DEDUPLICATION
   ↓
STORED
   ↓
RELEVANCE
   ↓
ENTITY / TOPIC ENRICHMENT
   ↓
SUMMARY
   ↓
EMBEDDING
   ↓
STORY CANDIDATE MATCHING
   ↓
CLUSTER OR NEW STORY
   ↓
RANK
   ↓
PUBLISH
```

Each later processing step should be retryable and idempotent.

---

## Stage 8 Ranking (migration `0016`)

### StoryRanking

Records one ranking calculation for a Story. Append-only: re-ranking creates a new row, preserving history.

Fields:
- `id`, `story_id`, `publication_id` (NULL = canonical)
- `ranking_method`, `ranking_version` (e.g., "weighted-sum", "ranking-score-v1")
- `calculated_score` (final score before public display)
- `signals` (JSONB: component scores for transparency)
- `calculated_at`, `time_horizon`, `explanation`
- `created_at`

Indexes: `story_id`, `calculated_at DESC`, `calculated_score DESC`, `(publication_id, story_id, calculated_at DESC)`, `(publication_id, calculated_score DESC)`

**Precedence:** Latest publication-specific ranking wins over canonical. A newer canonical ranking does NOT override an older publication-specific ranking.

**Invariant:** Ranking never mutates Story membership or Article source facts.

### PublicationStory additions

- `suppress_ranking` (boolean, default false): Exclude from ranked lists without unpublishing. Story detail page remains accessible.

Editorial controls (`featured`, `editorial_priority`, `suppress_ranking`) are applied during ranking calculation, not double-counted in SQL ordering.

---

## Stage 9A — Job Orchestration

### job_runs

Structured summaries of automated job executions for observability and operational history.

**Schema:**
- `id` (UUID, primary key)
- `job_name` (text): Job identifier (ingest, enrich, cluster, rank, pipeline)
- `status` (text): RUNNING, SUCCEEDED, PARTIAL, FAILED, SKIPPED
- `started_at` (timestamptz): When the job began
- `finished_at` (timestamptz, nullable): When the job completed
- `duration_ms` (integer, nullable): Execution time in milliseconds
- `attempted` (integer): Total items attempted (Sources/Articles/Stories)
- `succeeded` (integer): Items successfully processed
- `skipped` (integer): Items skipped (already current, ineligible, or job-level skip)
- `failed` (integer): Items that failed
- `retryable_failures` (integer): Subset of failures that are retryable (network, rate-limit)
- `error_summary` (text, nullable): Human-readable summary of failures (first few errors + counts)
- `metadata` (jsonb, nullable): Structured context (batch limits, provider info, failure details)
- `created_at` (timestamptz): Row creation timestamp

**Indexes:**
- `idx_job_runs_status_running`: `(job_name, started_at DESC) WHERE status = 'RUNNING'` — currently running jobs
- `idx_job_runs_job_status_finished`: `(job_name, status, finished_at DESC NULLS LAST)` — last successful run per job
- `idx_job_runs_started_at_desc`: `(started_at DESC)` — recent run history

**Status Semantics:**
- `RUNNING`: Job is executing (lock held)
- `SUCCEEDED`: All items processed successfully
- `PARTIAL`: Some items failed, but job completed
- `FAILED`: Systemic error (job could not run)
- `SKIPPED`: Lock was held, job did not execute (overlap prevention)

**Job-Level Skip vs Item-Level Skip:**
- `status = 'SKIPPED'` means the entire job was skipped (lock held)
- `skipped` counter: items skipped within a run (already current, ineligible)
- When `status = 'SKIPPED'`, the `skipped` counter is typically 1 (the job itself)

**Observability:**
No unbounded logs stored. Structured summaries only. Operators inspect full logs via stdout/log aggregator.

**Operational Queries:**
```sql
-- Currently running jobs
SELECT * FROM job_runs WHERE status = 'RUNNING' ORDER BY started_at DESC;

-- Last successful run for each job
SELECT DISTINCT ON (job_name) *
FROM job_runs
WHERE status = 'SUCCEEDED'
ORDER BY job_name, finished_at DESC;

-- Recent overlap attempts
SELECT * FROM job_runs WHERE status = 'SKIPPED' ORDER BY started_at DESC LIMIT 20;

-- Stuck jobs (running > 1 hour)
SELECT * FROM job_runs
WHERE status = 'RUNNING' AND started_at < NOW() - INTERVAL '1 hour';
```

**Invariants:**
- Append-only (no updates after completion)
- Every job run creates exactly one row (even on lock refusal)
- Parent pipeline creates 1 row; child stages create 1 row each
- No automatic cleanup (retention policy TBD)

---
