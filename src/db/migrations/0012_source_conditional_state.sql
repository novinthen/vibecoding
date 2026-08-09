-- Migration 0012 — Conditional-request state for Sources (Stage 3 ingestion).
--
-- Feed fetching issues conditional requests (RFC 9110): the validators returned
-- by the last successful fetch are replayed as If-None-Match / If-Modified-Since
-- so an unchanged feed answers 304 and is not re-downloaded. These validators
-- belong to the Source (they describe its current feed state), so they live on
-- the sources row rather than in the per-attempt audit log. They are opaque
-- source-supplied strings, never AI-derived, and carry no secrets.

ALTER TABLE sources
  ADD COLUMN etag          text,
  ADD COLUMN last_modified text;
