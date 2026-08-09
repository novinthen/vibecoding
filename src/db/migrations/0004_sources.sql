-- Migration 0004 — Sources and their fetch audit history.
--
-- A Source is a publisher/acquisition endpoint. SourceFetch is the operational
-- audit record for every fetch attempt, supporting source-health analysis and
-- debugging. Ingestion itself is Stage 3 — this migration only models the
-- canonical structure.

-- ---------------------------------------------------------------------------
-- Source
-- ---------------------------------------------------------------------------
CREATE TABLE sources (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  slug             text NOT NULL,
  homepage_url     text,
  feed_url         text,
  source_type      text NOT NULL
                     CHECK (source_type IN (
                       'RSS', 'ATOM', 'GITHUB', 'HACKER_NEWS',
                       'RSSHUB', 'API', 'MANUAL')),
  authority_tier   text NOT NULL
                     CHECK (authority_tier IN (
                       'PRIMARY', 'TRUSTED', 'SPECIALIST',
                       'COMMUNITY', 'DISCOVERY')),
  poll_interval    integer,
  enabled          boolean NOT NULL DEFAULT true,
  language         text,
  -- SET NULL: a Source keeps working if its default topic is removed.
  default_topic_id uuid REFERENCES topics (id) ON DELETE SET NULL,
  last_fetch_at    timestamptz,
  last_success_at  timestamptz,
  failure_count    integer NOT NULL DEFAULT 0,
  health_status    text NOT NULL DEFAULT 'UNKNOWN'
                     CHECK (health_status IN (
                       'HEALTHY', 'DEGRADED', 'FAILING', 'DISABLED', 'UNKNOWN')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sources_slug_key UNIQUE (slug),
  CONSTRAINT sources_poll_interval_positive
    CHECK (poll_interval IS NULL OR poll_interval > 0),
  CONSTRAINT sources_failure_count_non_negative CHECK (failure_count >= 0)
);

-- Access paths: filtering the registry by health and enabled state.
CREATE INDEX sources_enabled_health_idx ON sources (enabled, health_status);
CREATE INDEX sources_default_topic_id_idx ON sources (default_topic_id);

CREATE TRIGGER sources_set_updated_at
  BEFORE UPDATE ON sources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- SourceFetch — operational audit log per fetch attempt.
-- ---------------------------------------------------------------------------
CREATE TABLE source_fetches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE: fetch logs are operational telemetry bound to the source's
  -- existence; editorial audit lives in admin_audit_log, not here.
  source_id     uuid NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  status        text NOT NULL DEFAULT 'STARTED'
                  CHECK (status IN (
                    'STARTED', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED')),
  http_status   integer,
  items_found   integer,
  items_new     integer,
  items_updated integer,
  duration_ms   integer,
  error_code    text,
  error_message text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Access path: recent fetches for a given source.
CREATE INDEX source_fetches_source_started_idx
  ON source_fetches (source_id, started_at DESC);
