-- Migration 0006 — Entities, their aliases, and Article↔Entity relationships.
--
-- Entities are persistent objects users may browse or follow. Aliases map
-- alternate names onto one canonical Entity and must not be hardcoded in UI.

-- ---------------------------------------------------------------------------
-- Entity
-- ---------------------------------------------------------------------------
CREATE TABLE entities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  text NOT NULL
                 CHECK (entity_type IN (
                   'COMPANY', 'PRODUCT', 'MODEL', 'PROTOCOL',
                   'REPOSITORY', 'PERSON', 'ORGANIZATION')),
  name         text NOT NULL,
  slug         text NOT NULL,
  description  text,
  homepage_url text,
  github_url   text,
  logo_url     text,
  status       text NOT NULL DEFAULT 'ACTIVE'
                 CHECK (status IN ('ACTIVE', 'MERGED', 'HIDDEN')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entities_slug_key UNIQUE (slug)
);

CREATE INDEX entities_entity_type_idx ON entities (entity_type);

CREATE TRIGGER entities_set_updated_at
  BEFORE UPDATE ON entities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- EntityAlias — alternate names resolving to one canonical Entity.
-- ---------------------------------------------------------------------------
CREATE TABLE entity_aliases (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid NOT NULL REFERENCES entities (id) ON DELETE CASCADE,
  alias            text NOT NULL,
  normalized_alias text NOT NULL,
  source           text,
  confidence       double precision
                     CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- A normalized alias resolves to exactly one canonical Entity.
  CONSTRAINT entity_aliases_normalized_key UNIQUE (normalized_alias)
);

CREATE INDEX entity_aliases_entity_id_idx ON entity_aliases (entity_id);

-- ---------------------------------------------------------------------------
-- ArticleEntity — relationship between an Article and an Entity.
-- ---------------------------------------------------------------------------
CREATE TABLE article_entities (
  article_id   uuid NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  entity_id    uuid NOT NULL REFERENCES entities (id) ON DELETE CASCADE,
  relationship text NOT NULL DEFAULT 'MENTION'
                 CHECK (relationship IN (
                   'SUBJECT', 'MENTION', 'AUTHOR', 'CREATOR',
                   'ACQUIRER', 'PARTNER', 'COMPETITOR')),
  confidence   double precision
                 CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  source       text,
  -- One relationship row per (article, entity); prevents duplicate links.
  PRIMARY KEY (article_id, entity_id)
);

CREATE INDEX article_entities_entity_id_idx ON article_entities (entity_id);
