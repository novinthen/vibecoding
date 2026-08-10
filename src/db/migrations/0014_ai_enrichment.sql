-- Migration 0014 — Stage 6 AI enrichment: versioning, provenance, and status.
--
-- Extends the existing article_enrichments table (migration 0008) rather than
-- introducing a new one: AI-derived data continues to live OUT of the canonical
-- Article source fields. Every enrichment attempt — success, invalid output, or
-- provider error — is recorded as its own immutable, versioned row, so re-running
-- enrichment never destroys prior provenance and failures are auditable and
-- retryable. AI output remains advisory here: nothing in this migration promotes
-- it into any canonical Story/editorial field.

ALTER TABLE article_enrichments
  -- Monotonic per-Article version. Re-running enrichment creates a new version
  -- (never an in-place overwrite); the highest version is the latest attempt.
  ADD COLUMN enrichment_version integer NOT NULL DEFAULT 1,
  -- Version of the output schema the row was validated against (audit/repro).
  ADD COLUMN schema_version text,
  -- Outcome of the attempt. SUCCEEDED = validated structured output persisted;
  -- INVALID_OUTPUT = provider replied but failed strict validation (raw kept for
  -- debugging); PROVIDER_ERROR = the provider call itself failed.
  ADD COLUMN status text NOT NULL DEFAULT 'SUCCEEDED'
    CHECK (status IN ('SUCCEEDED', 'INVALID_OUTPUT', 'PROVIDER_ERROR')),
  -- Advisory relevance classification for the vibe-coding domain. UNCLASSIFIED
  -- covers failed/unvalidated attempts. A relevant classification NEVER publishes
  -- an Article on its own — promotion is a separate, explicit, approved workflow.
  ADD COLUMN relevance text
    CHECK (relevance IS NULL OR relevance IN (
      'RELEVANT', 'MAYBE_RELEVANT', 'IRRELEVANT', 'UNCLASSIFIED')),
  ADD COLUMN relevance_reason text,
  -- Suggested Topics/Entities as raw candidates. These are NEVER canonical: an
  -- explicit matching/review layer resolves them; nothing here writes an Entity,
  -- alias, Topic, or relationship. Stored as arrays of structured objects.
  ADD COLUMN suggested_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN suggested_entities jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Token/cost metadata reported by the provider, when available (cost control).
  ADD COLUMN usage jsonb,
  -- When the provider produced the output (distinct from row insertion time).
  ADD COLUMN generated_at timestamptz NOT NULL DEFAULT now(),
  -- Populated when status = INVALID_OUTPUT (why validation rejected the reply).
  ADD COLUMN validation_error text,
  -- Populated when status = PROVIDER_ERROR (classified code + safe message).
  ADD COLUMN error_code text,
  ADD COLUMN error_message text;

-- One row per (Article, version): makes versioning integrity a hard invariant
-- and makes the "latest enrichment" lookup a cheap MAX on an indexed column.
ALTER TABLE article_enrichments
  ADD CONSTRAINT article_enrichments_article_version_key
    UNIQUE (article_id, enrichment_version);
