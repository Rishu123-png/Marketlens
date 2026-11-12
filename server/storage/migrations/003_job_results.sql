-- Durable research result envelope and agent-run idempotency.
--
-- The report itself lives in `reports` (immutable). This table stores the
-- non-report parts needed to render a job after a page refresh: status, gate,
-- data warnings, compact evidence and any terminal error.

CREATE TABLE IF NOT EXISTS research_job_results (
  job_id        text PRIMARY KEY REFERENCES research_jobs (job_id) ON DELETE CASCADE,
  status        text,
  gate          jsonb,
  versions      jsonb,
  data_warnings jsonb,
  evidence      jsonb,
  error         text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- A QStash redelivery must not duplicate an agent row. Deduplicate any rows
-- written before this constraint existed, keeping the most recent payload.
DELETE FROM agent_runs older
 USING agent_runs newer
 WHERE older.job_id = newer.job_id
   AND older.agent = newer.agent
   AND older.id < newer.id;

CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_job_agent_uidx ON agent_runs (job_id, agent);
