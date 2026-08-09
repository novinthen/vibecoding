-- Migration 0010 — Embedding storage (prepared, never populated in Stage 2).
--
-- Embeddings live in separate records from Article/Story so that semantic search
-- and clustering (future stages) can be added without touching canonical facts.
-- The `embedding` column uses pgvector's dimensionless `vector` type: real
-- dimensions differ per model and are recorded in `dimensions`. Approximate
-- indexes (ivfflat/hnsw) require a fixed dimension and are deliberately deferred
-- to the stage that actually generates embeddings.

CREATE TABLE article_embeddings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  model      text NOT NULL,
  dimensions integer NOT NULL CHECK (dimensions > 0),
  embedding  vector NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One embedding per (article, model).
  CONSTRAINT article_embeddings_article_model_key UNIQUE (article_id, model)
);

CREATE INDEX article_embeddings_article_id_idx ON article_embeddings (article_id);

CREATE TABLE story_embeddings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id   uuid NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  model      text NOT NULL,
  dimensions integer NOT NULL CHECK (dimensions > 0),
  embedding  vector NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT story_embeddings_story_model_key UNIQUE (story_id, model)
);

CREATE INDEX story_embeddings_story_id_idx ON story_embeddings (story_id);
