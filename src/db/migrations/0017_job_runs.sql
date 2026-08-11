-- Migration 0017: Job run persistence (Stage 9A)
--
-- Stores structured summaries of automated job runs for observability,
-- debugging, and operational history. Supports bounded queries (recent runs,
-- last success per job, currently running) without storing full logs.

CREATE TABLE IF NOT EXISTS job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  attempted INTEGER NOT NULL DEFAULT 0,
  succeeded INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  retryable_failures INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for operational queries: "What is currently running?"
CREATE INDEX idx_job_runs_status_running ON job_runs (job_name, started_at DESC)
  WHERE status = 'RUNNING';

-- Index for history queries: "When was the last successful run of job X?"
CREATE INDEX idx_job_runs_job_status_finished ON job_runs (job_name, status, finished_at DESC NULLS LAST);

-- Index for recent runs (admin dashboard, debugging).
CREATE INDEX idx_job_runs_started_at_desc ON job_runs (started_at DESC);

COMMENT ON TABLE job_runs IS 'Stage 9A: Append-only log of automated job executions for observability and operational history.';
COMMENT ON COLUMN job_runs.job_name IS 'Job identifier (ingest, enrich, cluster, rank, pipeline).';
COMMENT ON COLUMN job_runs.status IS 'Final outcome: RUNNING (in-progress), SUCCEEDED (all items ok), PARTIAL (some failed), FAILED (systemic).';
COMMENT ON COLUMN job_runs.attempted IS 'Total items attempted (Sources, Articles, Stories).';
COMMENT ON COLUMN job_runs.succeeded IS 'Items successfully processed.';
COMMENT ON COLUMN job_runs.skipped IS 'Items skipped (already current, ineligible, locked).';
COMMENT ON COLUMN job_runs.failed IS 'Items that failed (subset of attempted).';
COMMENT ON COLUMN job_runs.retryable_failures IS 'Subset of failed that are retryable (network, rate-limit).';
COMMENT ON COLUMN job_runs.error_summary IS 'Human-readable summary of failures (first few errors, counts).';
COMMENT ON COLUMN job_runs.metadata IS 'Structured context (batch size, limits, version, individual failure details).';
