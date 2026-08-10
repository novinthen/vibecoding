-- Migration 0015 — Stage 7 Story clustering: provenance, review state, decisions.
--
-- Stage 7 forms canonical Stories by grouping Articles that describe the same
-- underlying event, while preserving every Article as independent evidence
-- (Article != Story). This migration adds ONLY the provenance/review scaffolding
-- clustering needs; it does not redesign the canonical Story model.
--
-- Invariants preserved by this schema:
--   * source Article facts are never touched by clustering (no columns added to
--     `articles`); clustering writes live in embeddings, story_articles
--     provenance, stories review columns, and the clustering_decisions log;
--   * embeddings remain DERIVED data with explicit provider/version provenance,
--     kept out of Article/Story source fields;
--   * a Story may be marked REVIEWED/LOCKED to protect it from autonomous
--     restructuring (false-merge / silent-split protection);
--   * every clustering attempt — including "no match" and "ambiguous" — is
--     recorded as an auditable decision row, so re-runs are explainable.

-- ---------------------------------------------------------------------------
-- Embedding provenance. Embeddings are derived data: record which provider and
-- pipeline version produced the currently-stored vector, plus a hash of the
-- exact text embedded so a stale embedding can be detected and refreshed. The
-- UNIQUE (…, model) key is kept: exactly one current embedding per (row, model),
-- so re-embedding upserts in place while historical decisions retain the
-- embedding_version they actually used (provenance survives a later refresh).
-- ---------------------------------------------------------------------------
ALTER TABLE article_embeddings
  ADD COLUMN provider text,
  ADD COLUMN embedding_version integer NOT NULL DEFAULT 1,
  ADD COLUMN source_content_hash text;

ALTER TABLE story_embeddings
  ADD COLUMN provider text,
  ADD COLUMN embedding_version integer NOT NULL DEFAULT 1,
  ADD COLUMN source_content_hash text;

-- ---------------------------------------------------------------------------
-- Story clustering provenance + review state.
--
-- review_state protects human decisions: UNREVIEWED is the default automatic
-- state; REVIEWED / LOCKED Stories are never auto-restructured by the clustering
-- engine (only explicit admin operations may change them). formation_source
-- records whether a Story was first formed automatically or by an editor.
-- ---------------------------------------------------------------------------
ALTER TABLE stories
  ADD COLUMN review_state text NOT NULL DEFAULT 'UNREVIEWED'
    CHECK (review_state IN ('UNREVIEWED', 'REVIEWED', 'LOCKED')),
  ADD COLUMN formation_source text NOT NULL DEFAULT 'AUTOMATIC'
    CHECK (formation_source IN ('AUTOMATIC', 'MANUAL')),
  -- Method/version that formed the Story (for reproducibility and upgrades).
  ADD COLUMN clustering_method text,
  ADD COLUMN clustering_version text;

CREATE INDEX stories_review_state_idx ON stories (review_state);

-- ---------------------------------------------------------------------------
-- Story <-> Article membership provenance. The existing columns (confidence,
-- assignment_source) are kept; these add the explainable clustering evidence for
-- one attachment: the decision score, a human-readable reason, the method/version
-- that produced it, and the raw signal breakdown. These are DERIVED annotations
-- on the membership; they never alter Article source facts.
-- ---------------------------------------------------------------------------
ALTER TABLE story_articles
  ADD COLUMN clustering_method text,
  ADD COLUMN clustering_version text,
  ADD COLUMN score double precision,
  ADD COLUMN decision_reason text,
  ADD COLUMN signals jsonb;

-- ---------------------------------------------------------------------------
-- ClusteringDecision — an append-only, auditable log of every clustering attempt
-- for an Article. One row per attempt records what was decided and why: the
-- method/version, the embedding provenance used, the outcome, the winning Story
-- (if any), the top score/confidence, and the full scored candidate set (as
-- JSONB) so an editor can review exactly which Stories were considered and why
-- one was or was not chosen. There is no FK to a specific enrichment/embedding
-- version — the columns capture provenance so the log survives their refresh.
-- ---------------------------------------------------------------------------
CREATE TABLE clustering_decisions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE: a decision is evidence about one Article; drop it with the Article.
  article_id        uuid NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  -- SET NULL: keep the decision record even if the chosen Story is later removed.
  story_id          uuid REFERENCES stories (id) ON DELETE SET NULL,
  method            text NOT NULL,
  method_version    text NOT NULL,
  embedding_provider text,
  embedding_model   text,
  embedding_version integer,
  -- Terminal outcome of the attempt. A new Story is always formed when there is
  -- no confident match, so "no candidates" / "below threshold" are recorded as
  -- the `reason`, not as separate outcomes.
  decision          text NOT NULL
                      CHECK (decision IN (
                        'CREATED_STORY', 'ASSIGNED_EXISTING', 'AMBIGUOUS',
                        'SKIPPED_EXISTING', 'SKIPPED_PROTECTED')),
  -- Whether the clustering engine (AUTOMATIC) or an editor (MANUAL) decided.
  decision_source   text NOT NULL DEFAULT 'AUTOMATIC'
                      CHECK (decision_source IN ('AUTOMATIC', 'MANUAL')),
  top_score         double precision,
  confidence        double precision
                      CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  candidate_count   integer NOT NULL DEFAULT 0,
  reason            text,
  -- Full scored candidate set considered for this attempt (for admin review).
  candidates        jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Winning signal breakdown, when a Story was chosen.
  signals           jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX clustering_decisions_article_id_idx
  ON clustering_decisions (article_id);
CREATE INDEX clustering_decisions_story_id_idx
  ON clustering_decisions (story_id);
CREATE INDEX clustering_decisions_created_at_idx
  ON clustering_decisions (created_at DESC);
