-- Job ownership: a SHA-256 hash of a browser-held bearer value.
-- Jobs created before this migration have NULL and remain legacy-readable.
ALTER TABLE research_jobs ADD COLUMN IF NOT EXISTS owner_hash text;
CREATE INDEX IF NOT EXISTS research_jobs_owner_idx ON research_jobs (owner_hash, created_at DESC);
