-- Migration 0016 — Stage 8 Story ranking: transparent, versioned ranking & trending.
--
-- Stage 8 adds a deterministic, explainable ranking layer that answers "Which
-- Stories matter most right now?" Ranking NEVER alters Story membership, Article
-- source facts, or auto-publishes Stories. It derives transparent signals
-- (freshness, source diversity, authority, activity, novelty, AI importance) and
-- combines them into a versioned, auditable score. Editorial prioritization
-- remains per-Publication via the existing publication_stories controls.
--
-- Invariants:
--   * Ranking never mutates Article source facts or Story membership;
--   * Ranking never auto-publishes a Story;
--   * Ranking is versioned and explainable (method, signals, provenance);
--   * Publication-aware: the same Story may rank differently by Publication;
--   * Ranking provenance is append-only (history is preserved);
--   * Editorial overrides are explicit and auditable.

-- ---------------------------------------------------------------------------
-- StoryRanking — versioned, provenanced ranking results for Stories.
--
-- Each row is one ranking calculation. Re-ranking a Story appends a new row
-- (history is preserved). The `publication_id` is NULL for canonical/global
-- rankings and non-NULL for publication-specific rankings. The `signals` JSONB
-- holds the component scores (freshness, source diversity, authority, etc.)
-- for transparency and debugging.
-- ---------------------------------------------------------------------------
CREATE TABLE story_rankings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE: ranking is evidence about one Story; drop it with the Story.
  story_id            uuid NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  -- SET NULL: preserve ranking history even if the Publication is deleted.
  publication_id      uuid REFERENCES publications (id) ON DELETE SET NULL,
  ranking_method      text NOT NULL,
  ranking_version     text NOT NULL,
  -- Final calculated score (before editorial adjustment).
  calculated_score    double precision NOT NULL,
  -- Component signal breakdown (JSONB for inspectability).
  signals             jsonb NOT NULL,
  calculated_at       timestamptz NOT NULL DEFAULT now(),
  -- Time context: e.g., "snapshot", "24h-window", "trending-6h".
  time_horizon        text,
  -- Human-readable explanation for transparency.
  explanation         text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX story_rankings_story_id_idx ON story_rankings (story_id);
CREATE INDEX story_rankings_calculated_at_idx ON story_rankings (calculated_at DESC);
CREATE INDEX story_rankings_score_idx ON story_rankings (calculated_score DESC);
CREATE INDEX story_rankings_method_version_idx
  ON story_rankings (ranking_method, ranking_version);
-- For publication-aware queries: find latest ranking for a Story in a Publication.
CREATE INDEX story_rankings_pub_story_idx
  ON story_rankings (publication_id, story_id, calculated_at DESC);
-- For top-ranked Stories in a Publication.
CREATE INDEX story_rankings_pub_score_idx
  ON story_rankings (publication_id, calculated_score DESC, calculated_at DESC)
  WHERE publication_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Extend publication_stories with explicit editorial ranking controls.
--
-- The existing `editorial_priority` (integer, default 0) and `featured` (boolean)
-- are already suitable for editorial boosts. We add `suppress_ranking` as an
-- explicit control to exclude a Story from ranked surfaces without unpublishing.
-- ---------------------------------------------------------------------------
ALTER TABLE publication_stories
  ADD COLUMN suppress_ranking boolean NOT NULL DEFAULT false;

-- Suppress comment: A suppressed Story remains PUBLISHED (detail page accessible)
-- but is excluded from ranked lists (homepage, trending, top stories). This is
-- distinct from UNPUBLISHED (not publicly accessible at all).
