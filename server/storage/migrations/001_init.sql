-- Market Lens durable storage — initial schema.
--
-- Design rules:
--  * Jobs, agent runs, evidence and reports are append-only artefacts. Reports
--    are never updated in place: a new revision is a new report row.
--  * Evidence stores the exact excerpt and retrieval time observed at analysis
--    time, so an old report can always be explained even if the source changed.
--  * JSON payloads are stored as jsonb; the authoritative shapes live in
--    shared/schemas and are validated before insert.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research_jobs (
  job_id                text PRIMARY KEY,
  instrument_id         text NOT NULL,
  depth                 text NOT NULL CHECK (depth IN ('quick', 'standard', 'comprehensive')),
  timeframe             text NOT NULL,
  history_period        text NOT NULL,
  news_lookback_days    integer NOT NULL DEFAULT 30,
  requested_modules     jsonb NOT NULL,
  status                text NOT NULL,
  gate                  jsonb,
  created_at            timestamptz NOT NULL,
  updated_at            timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS research_jobs_status_created_idx ON research_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS research_jobs_instrument_idx ON research_jobs (instrument_id, created_at DESC);

CREATE TABLE IF NOT EXISTS research_job_events (
  id          bigserial PRIMARY KEY,
  job_id      text NOT NULL REFERENCES research_jobs (job_id) ON DELETE CASCADE,
  from_status text,
  to_status   text NOT NULL,
  at          timestamptz NOT NULL,
  reason      text
);

CREATE INDEX IF NOT EXISTS research_job_events_job_idx ON research_job_events (job_id, at);

CREATE TABLE IF NOT EXISTS agent_runs (
  id              bigserial PRIMARY KEY,
  job_id          text REFERENCES research_jobs (job_id) ON DELETE CASCADE,
  agent           text NOT NULL,
  status          text NOT NULL,
  provider        text,
  model           text,
  prompt_version  text,
  schema_version  text,
  started_at      timestamptz,
  completed_at    timestamptz,
  duration_ms     integer,
  error           text,
  payload         jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_runs_job_idx ON agent_runs (job_id, agent);

CREATE TABLE IF NOT EXISTS evidence_items (
  evidence_id         text PRIMARY KEY,
  job_id              text REFERENCES research_jobs (job_id) ON DELETE SET NULL,
  source_type         text NOT NULL,
  publisher           text NOT NULL,
  url                 text,
  published_at        timestamptz,
  retrieved_at        timestamptz NOT NULL,
  excerpt             text,
  verification        text NOT NULL,
  dedupe_fingerprint  text NOT NULL,
  metadata            jsonb
);

CREATE INDEX IF NOT EXISTS evidence_items_fingerprint_idx ON evidence_items (dedupe_fingerprint);

CREATE TABLE IF NOT EXISTS reports (
  report_id       text PRIMARY KEY,
  job_id          text NOT NULL REFERENCES research_jobs (job_id) ON DELETE CASCADE,
  instrument_id   text NOT NULL,
  depth           text NOT NULL,
  sections        jsonb NOT NULL,
  agent_status    jsonb NOT NULL,
  evidence_ids    jsonb NOT NULL,
  gate            jsonb NOT NULL,
  methodology     text NOT NULL,
  versions        jsonb,
  created_at      timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS reports_job_idx ON reports (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_instrument_idx ON reports (instrument_id, created_at DESC);

-- Reports are immutable: a correction is a new row with a later created_at.
CREATE TABLE IF NOT EXISTS report_revisions (
  id          bigserial PRIMARY KEY,
  report_id   text NOT NULL REFERENCES reports (report_id) ON DELETE CASCADE,
  revised_at  timestamptz NOT NULL DEFAULT now(),
  reason      text NOT NULL
);
