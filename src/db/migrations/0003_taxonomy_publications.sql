-- Migration 0003 — Controlled taxonomy and publication configuration.
--
-- Topics are an editorially controlled taxonomy (top-level values are seeded and
-- must not be created automatically by AI). Publications and their domains model
-- the multi-publication layer: canonical intelligence is global, publishing is
-- publication-specific. No canonical table below assumes a single domain, brand,
-- locale, or language.

-- ---------------------------------------------------------------------------
-- Topic — controlled taxonomy (self-referential hierarchy).
-- ---------------------------------------------------------------------------
CREATE TABLE topics (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL,
  description text,
  -- RESTRICT: never silently orphan a sub-topic by deleting its parent.
  parent_id   uuid REFERENCES topics (id) ON DELETE RESTRICT,
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT topics_slug_key UNIQUE (slug),
  -- A topic cannot be its own parent (deeper cycles are prevented in the domain
  -- layer; a single self-reference is the only case cheaply enforceable here).
  CONSTRAINT topics_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX topics_parent_id_idx ON topics (parent_id);

CREATE TRIGGER topics_set_updated_at
  BEFORE UPDATE ON topics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Publication — one public editorial brand/site (not merely a language).
-- ---------------------------------------------------------------------------
CREATE TABLE publications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  slug             text NOT NULL,
  default_locale   text NOT NULL DEFAULT 'en',
  timezone         text NOT NULL DEFAULT 'UTC',
  status           text NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  editorial_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  branding         jsonb NOT NULL DEFAULT '{}'::jsonb,
  seo_settings     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publications_slug_key UNIQUE (slug)
);

CREATE TRIGGER publications_set_updated_at
  BEFORE UPDATE ON publications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- PublicationDomain — maps hostnames to Publications. Domain is globally unique.
-- ---------------------------------------------------------------------------
CREATE TABLE publication_domains (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid NOT NULL REFERENCES publications (id) ON DELETE CASCADE,
  domain         text NOT NULL,
  is_primary     boolean NOT NULL DEFAULT false,
  enabled        boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publication_domains_domain_key UNIQUE (domain)
);

CREATE INDEX publication_domains_publication_id_idx
  ON publication_domains (publication_id);

-- At most one primary domain per publication.
CREATE UNIQUE INDEX publication_domains_one_primary_idx
  ON publication_domains (publication_id)
  WHERE is_primary;
