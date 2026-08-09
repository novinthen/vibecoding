# Canonical Data Model

## Most Important Rule

**Article and Story are different.**

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

Stores language/localisation variants. Recommended fields: `id`, `publication_id`, `story_id`, `locale`, `headline`, `summary`, `why_it_matters`, `translation_source`, `model_provider`, `model_name`, `status`, `reviewed_by`, `created_at`, `updated_at`. Do not model languages as `title_en`, `title_ms`, etc.

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

Recommended fields:

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

This design supports reprocessing and auditability.

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
- StoryLocalization publication_id + story_id + locale
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
