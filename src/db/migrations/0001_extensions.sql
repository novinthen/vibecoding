-- Migration 0001 — Required PostgreSQL extensions.
--
-- pgcrypto provides gen_random_uuid() for UUID primary keys. (Core PostgreSQL
-- 13+ also exposes gen_random_uuid(), but enabling pgcrypto keeps the schema
-- portable across managed providers.)
--
-- vector (pgvector) is prepared here so that embedding tables can be created in
-- a later migration. No embeddings are generated during Stage 2 — this only
-- readies the database for the future semantic-search / clustering stages. On
-- Supabase the extension is available out of the box; locally it is provided by
-- the pgvector/pgvector Docker image (see README).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
