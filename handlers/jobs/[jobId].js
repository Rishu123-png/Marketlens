// Research job status, report and agent runs. Poll this after creating a job.
import { JobNotFoundError, resolveJobStore } from "../../server/jobs/store.js";
import { rateLimit } from "../../lib/server/rateLimit.js";
import { ownerFromRequest, ownerMatches } from "../../server/jobs/access.js";
import { getQueue, queueStatus } from "../../server/jobs/queue.js";
import { JobTransitionError } from "../../server/orchestrator/jobLifecycle.js";

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
    usage: run.usage ?? null,
    credentialEnvName: run.credentialEnvName ?? null,
    credentialMode: run.credentialMode ?? "none",
    requestCount: run.requestCount ?? 0,
    httpStatus: run.httpStatus ?? null,
    rateLimit: run.rateLimit ?? null,
    toolRounds: run.toolRounds ?? 0,
    toolsDisabled: run.toolsDisabled === true,
    toolCalls: Array.isArray(run.toolCalls)
      ? run.toolCalls.map((call) => ({ tool: call.tool ?? call.name ?? "unknown", ok: call.ok ?? null }))
      : [],
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
    const owner = ownerFromRequest(req);
    const jobOwnerHash = typeof store.getOwnerHash === "function" ? await store.getOwnerHash(jobId) : null;
    if (!ownerMatches(jobOwnerHash, owner)) {
      // 404 rather than 403: do not confirm that someone else's job exists.
      return res.status(404).json({ error: "Research job not found.", jobId });
    }

    if (req.method === "DELETE") {
      const cancelled = await store.cancel(jobId);
      if (cancelled.status === "CANCELLED") {
        const queue = getQueue();
        if (queue.id === "memory") queue.acknowledge(jobId);
      }
      return res.status(200).json({
        jobId,
        status: cancelled.status,
        cancelled: cancelled.status === "CANCELLED",
        ...(cancelled.status !== "CANCELLED" ? { note: "The job had already finished; nothing was cancelled." } : {})
      });
    }

    if (req.method === "POST") {
      // Explicit retry: only FAILED/BLOCKED, owner-scoped, one fresh queue
      // delivery. The retry counter is visible in the transition history.
      const retried = await store.retry(jobId, { reason: "retry requested by owner" });
      try {
        const delivery = await getQueue().enqueue({
          jobId,
          retry: true,
          deduplicationId: `${jobId}:retry:${Date.now()}`
        });
        return res.status(202).json({
          jobId,
          status: retried.status,
          retried: true,
          queue: delivery,
          queueStatus: queueStatus().active,
          note: "The job was re-queued. Previous agent runs and the previous report are retained."
        });
      } catch (error) {
        await store.fail(jobId, `Retry queue delivery failed: ${error instanceof Error ? error.message : "unknown"}`);
        return res.status(503).json({
          error: "The job could not be re-queued.",
          retryAfterSeconds: 30
        });
      }
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
      runConfig: result?.runConfig ?? null,
      dataSnapshot: result?.dataSnapshot ?? null,
      reproducibility: result?.report
        ? {
            replayable: true,
            replayUrl: `/api/jobs/${encodeURIComponent(jobId)}/replay`,
            note: "Replay reads stored evidence and data snapshot; it does not fetch a new series."
          }
        : { replayable: false, note: "No stored report is available yet." },
      note:
        job.status === "QUEUED" || job.status === "RUNNING"
          ? "Research is still running. Poll again shortly."
          : null
    });
  } catch (error) {
    if (error instanceof JobNotFoundError) {
      return res.status(404).json({ error: "Research job not found.", jobId });
    }
    if (error instanceof JobTransitionError) {
      return res.status(409).json({ error: error.message, jobId, from: error.from, to: error.to });
    }
    return res.status(500).json({ error: "Could not load the research job." });
  }
}
