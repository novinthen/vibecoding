-- Migration 0018 — Source-specific adapter configuration (Stage 9B).
--
-- Configuration belongs to the Source, not Article. Existing RSS/Atom Sources use
-- the empty object and continue using feed_url. Secrets are intentionally not
-- stored here; provider credentials remain server-only environment configuration.

ALTER TABLE sources
  ADD COLUMN source_config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE sources
  ADD CONSTRAINT sources_source_config_object_check
  CHECK (jsonb_typeof(source_config) = 'object');
