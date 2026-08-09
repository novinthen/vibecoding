-- Migration 0009 — Publication-specific publishing and localisation.
--
-- Canonical intelligence (Story/Article facts) is global; PUBLISHING is
-- publication-specific. PublicationStory controls whether and how a canonical
-- Story appears for one Publication; StoryLocalization stores language/editorial
-- variants. Neither table alters canonical Article/Story facts — they only carry
-- presentation. One Story may be published by many Publications.

-- ---------------------------------------------------------------------------
-- PublicationStory — per-Publication publishing control for a canonical Story.
-- ---------------------------------------------------------------------------
CREATE TABLE publication_stories (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id           uuid NOT NULL REFERENCES publications (id) ON DELETE CASCADE,
  story_id                 uuid NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  status                   text NOT NULL DEFAULT 'DRAFT'
                             CHECK (status IN (
                               'DRAFT', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED')),
  slug                     text,
  headline                 text,
  published_summary        text,
  published_why_it_matters text,
  featured                 boolean NOT NULL DEFAULT false,
  editorial_priority       integer NOT NULL DEFAULT 0,
  published_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  -- Prevent duplicate Publication–Story relationships.
  CONSTRAINT publication_stories_pub_story_key UNIQUE (publication_id, story_id)
);

-- Per-Publication slug uniqueness (a slug is only meaningful within a
-- Publication). Partial: slugs may be NULL before publishing.
CREATE UNIQUE INDEX publication_stories_pub_slug_key
  ON publication_stories (publication_id, slug)
  WHERE slug IS NOT NULL;

CREATE INDEX publication_stories_story_id_idx ON publication_stories (story_id);
CREATE INDEX publication_stories_pub_status_idx
  ON publication_stories (publication_id, status);

CREATE TRIGGER publication_stories_set_updated_at
  BEFORE UPDATE ON publication_stories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- StoryLocalization — language/localisation variants per Publication.
-- Languages are modelled as rows keyed by locale, never as title_en/title_ms
-- columns.
-- ---------------------------------------------------------------------------
CREATE TABLE story_localizations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id     uuid NOT NULL REFERENCES publications (id) ON DELETE CASCADE,
  story_id           uuid NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  locale             text NOT NULL,
  headline           text,
  summary            text,
  why_it_matters     text,
  translation_source text
                       CHECK (translation_source IS NULL OR translation_source IN (
                         'HUMAN', 'MACHINE', 'MACHINE_REVIEWED')),
  model_provider     text,
  model_name         text,
  status             text NOT NULL DEFAULT 'DRAFT'
                       CHECK (status IN ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED')),
  reviewed_by        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- One localisation per (publication, story, locale).
  CONSTRAINT story_localizations_pub_story_locale_key
    UNIQUE (publication_id, story_id, locale)
);

CREATE INDEX story_localizations_story_id_idx ON story_localizations (story_id);

CREATE TRIGGER story_localizations_set_updated_at
  BEFORE UPDATE ON story_localizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
