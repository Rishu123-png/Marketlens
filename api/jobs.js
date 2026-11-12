// Research job list (newest first). Summaries only; results live on the job.
import { resolveJobStore } from "../server/jobs/store.js";
import { queueStatus } from "../server/jobs/queue.js";
import { rateLimit } from "../lib/server/rateLimit.js";

export default async function handler(req, res) {
  const quota = await rateLimit(req, { name: "jobs", limit: 60, windowMs: 60_000 });
  if (!quota.allowed) {
    res.setHeader?.("Retry-After", String(quota.retryAfterSeconds));
    return res.status(429).json({ error: "Too many job requests.", retryAfterSeconds: quota.retryAfterSeconds });
  }

  const limit = Number(req.query?.limit || 20);
  const status = typeof req.query?.status === "string" ? req.query.status.toUpperCase() : null;

  const store = await resolveJobStore();
  const rows = await store.list({ limit, status });
  const jobs = rows.map((job) => ({
    jobId: job.jobId,
    instrumentId: job.instrumentId,
    depth: job.depth,
    status: job.status,
    gateVerdict: job.gate?.verdict ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  }));

  return res.status(200).json({
    jobs,
    queue: queueStatus(),
    note: "Jobs are process-local unless the PostgreSQL store is configured."
  });
}
