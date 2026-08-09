-- Migration 0005 — Article: the canonical record of one publisher item.
--
-- Provenance rule (DATA_MODEL.md): source-supplied fields are preserved and must
-- never be overwritten by AI-derived content. AI output lives in separate
-- versioned tables (see 0008_enrichment.sql), never in these columns.

CREATE TABLE articles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: deleting a Source must not silently destroy canonical Articles.
  source_id         uuid NOT NULL REFERENCES sources (id) ON DELETE RESTRICT,
  external_id       text,
  url               text NOT NULL,
  canonical_url     text,
  url_hash          text,
  original_title    text NOT NULL,
  normalized_title  text,
  original_excerpt  text,
  clean_text        text,
  author            text,
  published_at      timestamptz,
  source_updated_at timestamptz,
  discovered_at     timestamptz NOT NULL DEFAULT now(),
  image_url         text,
  language          text,
  content_hash      text,
  status            text NOT NULL DEFAULT 'DISCOVERED'
                      CHECK (status IN (
                        'DISCOVERED', 'NORMALIZED', 'DUPLICATE', 'QUEUED',
                        'ENRICHED', 'CLUSTERED', 'PUBLISHED', 'HIDDEN', 'FAILED')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Duplicate prevention within a single Source. Partial indexes so that many
-- NULLs (unknown external_id / not-yet-hashed url) never collide — cross-source
-- syndication dedup is a deliberate Stage 3 concern, not a hard DB constraint.
CREATE UNIQUE INDEX articles_source_external_id_key
  ON articles (source_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX articles_source_url_hash_key
  ON articles (source_id, url_hash)
  WHERE url_hash IS NOT NULL;

-- Access paths.
CREATE INDEX articles_url_hash_idx ON articles (url_hash) WHERE url_hash IS NOT NULL;
CREATE INDEX articles_canonical_url_idx
  ON articles (canonical_url) WHERE canonical_url IS NOT NULL;
CREATE INDEX articles_published_at_idx ON articles (published_at DESC);
CREATE INDEX articles_status_idx ON articles (status);
CREATE INDEX articles_source_id_idx ON articles (source_id);

CREATE TRIGGER articles_set_updated_at
  BEFORE UPDATE ON articles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
