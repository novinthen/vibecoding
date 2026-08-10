-- Migration 0013 — Full-text search vector for public Article search.
--
-- Stage 5 ships MVP public search using PostgreSQL's built-in full-text search
-- (docs/ARCHITECTURE.md: "Start with PostgreSQL full-text search"; no external
-- search engine is introduced). A generated, STORED tsvector keeps the index in
-- sync automatically on insert/update — no application code or trigger has to
-- maintain it, and it can never drift from the source columns.
--
-- Only source-supplied fields feed the vector (title + excerpt); this is a
-- derived search artifact over canonical facts, not AI-derived content, so it is
-- consistent with keeping source facts separate from enrichment.

ALTER TABLE articles
  ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (
      to_tsvector(
        'english',
        coalesce(original_title, '') || ' ' || coalesce(original_excerpt, '')
      )
    ) STORED;

CREATE INDEX articles_search_vector_idx ON articles USING gin (search_vector);
