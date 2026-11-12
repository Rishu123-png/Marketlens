// HTTP entry point for queue deliveries (QStash → this function).
//
// The worker runs a single research job and returns its final status. It is a
// separate deployment from the API in production; this handler exists so a
// queue can invoke it over HTTP. Requests must present WORKER_SECRET.
//
// Limitation: Upstash request-signature verification is not implemented yet;
// until it is, WORKER_SECRET is mandatory and QStash delivery must be
// configured to send it.
import { getJobStore, resolveJobStore } from "../server/jobs/store.js";
import { JobRunner, drainQueue } from "../server/jobs/worker.js";

export default async function handler(req, res) {
  if (req.method && req.method !== "POST") {
    res.setHeader?.("Allow", "POST");
    return res.status(405).json({ error: "Worker deliveries must use POST." });
  }

  const secret = process.env.WORKER_SECRET;
  if (!secret) {
    return res.status(503).json({
      error: "WORKER_SECRET is not configured; the worker endpoint is disabled.",
      configuration: "WORKER_SECRET"
    });
  }

  const provided = req.headers?.["x-worker-secret"];
  if (provided !== secret) {
    return res.status(401).json({ error: "Unauthorized worker delivery." });
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  const jobId = String(body.jobId || "").trim();
  const store = await resolveJobStore();

  if (!jobId) {
    const processed = await drainQueue({ store, limit: 1 });
    return res.status(200).json({ processed: processed.length });
  }

  if (!store.has(jobId)) return res.status(404).json({ error: "Research job not found.", jobId });

  const runner = new JobRunner({ store });
  const outcome = await runner.process(jobId);

  return res.status(200).json({
    jobId,
    status: outcome.job?.status ?? "FAILED",
    gateVerdict: outcome.result?.gate?.verdict ?? null,
    error: outcome.error ? String(outcome.error.message || outcome.error) : null
  });
}

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
