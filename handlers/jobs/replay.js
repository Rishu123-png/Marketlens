// Stored-report replay. GET only, owner-scoped and deliberately network-free:
// it reads the report, evidence, run configuration and data snapshot that were
// persisted with the job. It never calls a provider or a model.
import { JobNotFoundError, resolveJobStore } from "../../server/jobs/store.js";
import { rateLimit } from "../../lib/server/rateLimit.js";
import { ownerFromRequest, ownerMatches } from "../../server/jobs/access.js";
import { buildReplayPayload } from "../../server/orchestrator/reproducibility.js";

export default async function handler(req, res) {
  const quota = await rateLimit(req, { name: "job-replay", limit: 60, windowMs: 60_000 });
  if (!quota.allowed) {
    res.setHeader?.("Retry-After", String(quota.retryAfterSeconds));
    return res.status(429).json({ error: "Too many replay requests.", retryAfterSeconds: quota.retryAfterSeconds });
  }

  if (req.method !== "GET") {
    res.setHeader?.("Allow", "GET");
    return res.status(405).json({ error: "Replay is read-only. Use GET." });
  }

  const jobId = String(req.query?.jobId || "").trim();
  const store = await resolveJobStore();

  try {
    const job = await store.get(jobId);
    const owner = ownerFromRequest(req);
    const jobOwnerHash = typeof store.getOwnerHash === "function" ? await store.getOwnerHash(jobId) : null;
    if (!ownerMatches(jobOwnerHash, owner)) {
      return res.status(404).json({ error: "Research job not found.", jobId });
    }

    const result = await store.getResult(jobId);
    const runs = (await store.getAgentRuns(jobId)) || {};
    const payload = buildReplayPayload({ job, result, agentRuns: runs });

    if (!payload.replayable) {
      return res.status(409).json({ jobId, ...payload });
    }

    res.setHeader?.("Cache-Control", "private, no-store");
    return res.status(200).json({ jobId, ...payload });
  } catch (error) {
    if (error instanceof JobNotFoundError) {
      return res.status(404).json({ error: "Research job not found.", jobId });
    }
    return res.status(500).json({ error: "Could not replay the stored research report." });
  }
}
