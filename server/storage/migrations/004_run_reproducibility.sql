-- Reproducibility: persist what produced a run, and the exact data it saw.
--
-- The report and evidence are already immutable artefacts. These two columns
-- let a replay answer "which provider, timestamps, candle range and model
-- configuration produced this?" without fetching a new series.

ALTER TABLE research_job_results
  ADD COLUMN IF NOT EXISTS run_config jsonb,
  ADD COLUMN IF NOT EXISTS data_snapshot jsonb;
