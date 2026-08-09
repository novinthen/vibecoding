-- Migration 0008 — ArticleEnrichment: versioned, AI-derived output.
--
-- This table exists precisely to keep AI-derived data OUT of the canonical
-- Article source fields. Each row is one model/prompt run; storing them
-- separately (never overwriting) supports reprocessing, auditability, and
-- explicit promotion into canonical Story projection fields. No enrichment is
-- generated during Stage 2 — this is structure only.

CREATE TABLE article_enrichments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id        uuid NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  model_provider    text NOT NULL,
  model_name        text NOT NULL,
  prompt_name       text,
  prompt_version    text,
  summary           text,
  why_it_matters    text,
  relevance_score   double precision,
  importance_score  double precision,
  technical_depth   double precision,
  novelty_score     double precision,
  confidence        double precision
                      CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  structured_output jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Access path: latest enrichment(s) for an Article.
CREATE INDEX article_enrichments_article_created_idx
  ON article_enrichments (article_id, created_at DESC);
