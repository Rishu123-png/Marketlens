// Research job status, report and agent runs. Poll this after creating a job.
import { JobNotFoundError, resolveJobStore } from "../../server/jobs/store.js";
import { rateLimit } from "../../lib/server/rateLimit.js";

function summariseRun(run) {
  return {
    agent: run.agent,
    status: run.status,
    error: run.error,
    attempts: run.attempts,
    retries: run.retries,
    provider: run.provider,
    model: run.model,
    promptVersion: run.promptVersion,
    schemaVersion: run.schemaVersion,
    durationMs: run.durationMs,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    modelFallback: run.modelFallback ?? null
  };
}

export default async function handler(req, res) {
  const quota = await rateLimit(req, { name: "job-detail", limit: 120, windowMs: 60_000 });
  if (!quota.allowed) {
    res.setHeader?.("Retry-After", String(quota.retryAfterSeconds));
    return res.status(429).json({ error: "Too many job requests.", retryAfterSeconds: quota.retryAfterSeconds });
  }

  const jobId = String(req.query?.jobId || "").trim();
  const store = await resolveJobStore();

  try {
    const job = await store.get(jobId);

    if (req.method === "DELETE") {
      const cancelled = await store.cancel(jobId);
      return res.status(200).json({
        jobId,
        status: cancelled.status,
        cancelled: cancelled.status === "CANCELLED",
        ...(cancelled.status !== "CANCELLED" ? { note: "The job had already finished; nothing was cancelled." } : {})
      });
    }

    const result = await store.getResult(jobId);
    const runs = (await store.getAgentRuns(jobId)) || {};

    return res.status(200).json({
      job,
      agentRuns: Object.fromEntries(Object.entries(runs).map(([agent, run]) => [agent, summariseRun(run)])),
      report: result?.report ?? null,
      gate: job.gate ?? result?.gate ?? null,
      evidence: result?.evidence ?? null,
      dataWarnings: result?.dataWarnings ?? null,
      error: result?.error ?? null,
      versions: result?.versions ?? null,
      note:
        job.status === "QUEUED" || job.status === "RUNNING"
          ? "Research is still running. Poll again shortly."
          : null
    });
  } catch (error) {
    if (error instanceof JobNotFoundError) {
      return res.status(404).json({ error: "Research job not found.", jobId });
    }
    return res.status(500).json({ error: "Could not load the research job." });
  }
}
