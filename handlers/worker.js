// HTTP entry point for queue deliveries (QStash → this function).
//
// The worker runs a single research job and returns its final status. It is a
// separate deployment from the API in production; this handler exists so a
// queue can invoke it over HTTP. Requests must present WORKER_SECRET.
//
// QStash deliveries can be authenticated in two ways:
//   1. Upstash-Signature (verified when QSTASH_CURRENT_SIGNING_KEY is set), or
//   2. x-worker-secret (WORKER_SECRET), which remains mandatory when no signing
//      key is configured.
// Signature verification is strict: if the signed body claim cannot be checked
// because the runtime did not preserve the raw body, the request is refused
// rather than accepted unverified.
import { resolveJobStore } from "../server/jobs/store.js";
import { timingSafeEqual } from "node:crypto";
import { qstashKeys, verifyQstashSignature } from "../server/jobs/qstashSignature.js";
import { JobRunner, drainQueue } from "../server/jobs/worker.js";
import { isTerminalJobStatus } from "../server/orchestrator/jobLifecycle.js";

export default async function handler(req, res) {
  if (req.method && req.method !== "POST") {
    res.setHeader?.("Allow", "POST");
    return res.status(405).json({ error: "Worker deliveries must use POST." });
  }

  const secret = process.env.WORKER_SECRET;
  const signatureHeader = req.headers?.["upstash-signature"];
  const signingKeys = qstashKeys();

  let authorized = false;
  let authMethod = null;

  if (signatureHeader && signingKeys.length) {
    // Vercel parses JSON bodies before the handler runs. The signature binds the
    // exact raw bytes, so try the runtime's raw body when present and the
    // canonical JSON serialization otherwise. Verification still fails closed if
    // neither reproduces the signed digest.
    const candidates = rawBodyCandidates(req);
    let verdict = { ok: false, status: "body-unavailable", reason: "Raw request body is not available." };
    for (const rawBody of candidates) {
      verdict = verifyQstashSignature({ signature: String(signatureHeader), rawBody });
      if (verdict.ok) break;
    }
    if (!verdict.ok) {
      return res.status(401).json({
        error: "Unauthorized QStash delivery.",
        reason: verdict.reason,
        verification: verdict.status
      });
    }
    authorized = true;
    authMethod = "qstash-signature";
  }

  if (!authorized && secret) {
    const provided = req.headers?.["x-worker-secret"];
    const providedBuffer = Buffer.from(String(provided ?? ""));
    const secretBuffer = Buffer.from(String(secret));
    if (providedBuffer.length === secretBuffer.length && timingSafeEqual(providedBuffer, secretBuffer)) {
      authorized = true;
      authMethod = "worker-secret";
    }
  }

  if (!authorized) {
    if (!secret && !signingKeys.length) {
      return res.status(503).json({
        error: "Neither WORKER_SECRET nor a QStash signing key is configured; the worker endpoint is disabled.",
        configuration: ["WORKER_SECRET", "QSTASH_CURRENT_SIGNING_KEY"]
      });
    }
    return res.status(401).json({ error: "Unauthorized worker delivery." });
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  const jobId = String(body.jobId || "").trim();
  const store = await resolveJobStore();

  if (!jobId) {
    const processed = await drainQueue({ store, limit: 1 });
    return res.status(200).json({ processed: processed.length });
  }

  if (!(await store.has(jobId))) return res.status(404).json({ error: "Research job not found.", jobId });

  // QStash retries and at-least-once delivery must not re-run completed work or
  // create a second report. A duplicate delivery acknowledges with the current
  // state instead.
  const snapshot = await store.get(jobId);
  if (isTerminalJobStatus(snapshot.status)) {
    return res.status(200).json({
      jobId,
      authMethod,
      status: snapshot.status,
      skipped: true,
      reason: "job already reached a terminal status"
    });
  }
  if (snapshot.status === "RUNNING") {
    return res.status(200).json({
      jobId,
      authMethod,
      status: snapshot.status,
      skipped: true,
      reason: "another delivery already claimed this job"
    });
  }

  const runner = new JobRunner({ store });
  const outcome = await runner.process(jobId);

  return res.status(200).json({
    jobId,
    authMethod,
    status: outcome.job?.status ?? "FAILED",
    gateVerdict: outcome.result?.gate?.verdict ?? null,
    error: outcome.error ? String(outcome.error.message || outcome.error) : null
  });
}

function rawBodyCandidates(req) {
  if (Buffer.isBuffer(req?.rawBody)) return [req.rawBody.toString("utf8")];
  if (typeof req?.rawBody === "string") return [req.rawBody];
  if (Buffer.isBuffer(req?.body)) return [req.body.toString("utf8")];
  if (typeof req?.body === "string") return [req.body];
  if (req?.body && typeof req.body === "object") {
    try {
      return [JSON.stringify(req.body)];
    } catch {
      return [];
    }
  }
  return [];
}

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
