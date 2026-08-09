-- Migration 0007 — Story, Story↔Article membership, and Story↔Entity links.
--
-- A Story is a real-world event that may contain many Articles. `summary` and
-- `why_it_matters` are CANONICAL EDITORIAL PROJECTION fields — raw AI output
-- must first live in a versioned enrichment record and only be promoted here via
-- an explicit editorial/validation workflow. Article ≠ Story is preserved: the
-- many-to-many link lives in story_articles, never by folding one into the other.

-- ---------------------------------------------------------------------------
-- Story
-- ---------------------------------------------------------------------------
CREATE TABLE stories (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL,
  canonical_title   text NOT NULL,
  summary           text,
  why_it_matters    text,
  -- SET NULL: keep the Story if its primary topic is removed.
  primary_topic_id  uuid REFERENCES topics (id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN (
                        'DRAFT', 'ACTIVE', 'MERGED', 'SUPPRESSED', 'ARCHIVED')),
  first_published_at timestamptz,
  last_activity_at  timestamptz,
  -- SET NULL: the primary-article pointer clears rather than deleting the Story.
  primary_article_id uuid REFERENCES articles (id) ON DELETE SET NULL,
  importance_score  double precision,
  trending_score    double precision,
  confidence        double precision
                      CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stories_slug_key UNIQUE (slug)
);

CREATE INDEX stories_status_idx ON stories (status);
CREATE INDEX stories_last_activity_at_idx ON stories (last_activity_at DESC);
CREATE INDEX stories_primary_topic_id_idx ON stories (primary_topic_id);

CREATE TRIGGER stories_set_updated_at
  BEFORE UPDATE ON stories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- StoryArticle — many-to-many between Stories and Articles.
-- ---------------------------------------------------------------------------
CREATE TABLE story_articles (
  story_id          uuid NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  article_id        uuid NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  relationship_type text NOT NULL DEFAULT 'RELATED'
                      CHECK (relationship_type IN (
                        'PRIMARY', 'SUPPORTING', 'OFFICIAL',
                        'REACTION', 'COMMENTARY', 'RELATED')),
  confidence        double precision
                      CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  assignment_source text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Prevent duplicate Story–Article relationships.
  PRIMARY KEY (story_id, article_id)
);

CREATE INDEX story_articles_article_id_idx ON story_articles (article_id);

-- At most one PRIMARY article per Story.
CREATE UNIQUE INDEX story_articles_one_primary_idx
  ON story_articles (story_id)
  WHERE relationship_type = 'PRIMARY';

-- ---------------------------------------------------------------------------
-- StoryEntity — persistent Story↔Entity relationship (not recomputed per page).
-- ---------------------------------------------------------------------------
CREATE TABLE story_entities (
  story_id     uuid NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  entity_id    uuid NOT NULL REFERENCES entities (id) ON DELETE CASCADE,
  relationship text NOT NULL DEFAULT 'MENTION'
                 CHECK (relationship IN (
                   'SUBJECT', 'MENTION', 'AUTHOR', 'CREATOR',
                   'ACQUIRER', 'PARTNER', 'COMPETITOR')),
  importance   double precision,
  confidence   double precision
                 CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  PRIMARY KEY (story_id, entity_id)
);

CREATE INDEX story_entities_entity_id_idx ON story_entities (entity_id);
