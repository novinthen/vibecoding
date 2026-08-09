-- Migration 0002 — Shared schema helpers.
--
-- set_updated_at() keeps `updated_at` columns authoritative at the database
-- level instead of trusting application code to remember. Attached via triggers
-- to every table that carries an updated_at column.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
