/**
 * Research-job lifecycle.
 *
 * The orchestrator may only move a job along the transitions declared here.
 * Everything else throws, so an invalid state can never be persisted or served
 * as if it were a normal progression.
 */

import { randomBytes } from "node:crypto";
import { JOB_STATUSES, researchJobSchema } from "../../shared/schemas/research.js";
import { AGENT_STATUSES } from "../../shared/schemas/agent.js";

export const JOB_TRANSITIONS = Object.freeze({
  CREATED: Object.freeze(["VALIDATING", "CANCELLED", "FAILED"]),
  VALIDATING: Object.freeze(["QUEUED", "BLOCKED", "FAILED", "CANCELLED"]),
  QUEUED: Object.freeze(["RUNNING", "CANCELLED", "FAILED"]),
  RUNNING: Object.freeze(["COMPLETED", "PARTIAL", "BLOCKED", "FAILED", "CANCELLED"]),
  // Terminal states. Partial research is a finished artifact, not a step that
  // automatically becomes complete.
  PARTIAL: Object.freeze([]),
  COMPLETED: Object.freeze([]),
  BLOCKED: Object.freeze([]),
  FAILED: Object.freeze([]),
  CANCELLED: Object.freeze([])
});

export const AGENT_TRANSITIONS = Object.freeze({
  PENDING: Object.freeze(["QUEUED", "SKIPPED", "BLOCKED"]),
  QUEUED: Object.freeze(["RUNNING", "SKIPPED", "BLOCKED", "FAILED"]),
  RUNNING: Object.freeze(["COMPLETED", "FAILED", "RETRYING"]),
  RETRYING: Object.freeze(["RUNNING", "FAILED"]),
  COMPLETED: Object.freeze([]),
  FAILED: Object.freeze([]),
  SKIPPED: Object.freeze([]),
  BLOCKED: Object.freeze([])
});

export const TERMINAL_JOB_STATUSES = Object.freeze(
  JOB_STATUSES.filter((status) => JOB_TRANSITIONS[status].length === 0)
);

export class JobTransitionError extends Error {
  constructor(from, to, message) {
    super(message || `Illegal research-job transition: ${from} → ${to}`);
    this.name = "JobTransitionError";
    this.code = "ILLEGAL_JOB_TRANSITION";
    this.statusCode = 409;
    this.from = from;
    this.to = to;
  }
}

export class AgentTransitionError extends Error {
  constructor(from, to) {
    super(`Illegal agent transition: ${from} → ${to}`);
    this.name = "AgentTransitionError";
    this.code = "ILLEGAL_AGENT_TRANSITION";
    this.statusCode = 409;
    this.from = from;
    this.to = to;
  }
}

export function canTransitionJob(from, to) {
  return Boolean(JOB_TRANSITIONS[from]?.includes(to));
}

export function isTerminalJobStatus(status) {
  return TERMINAL_JOB_STATUSES.includes(status);
}

export function assertJobTransition(from, to) {
  if (!JOB_STATUSES.includes(to)) throw new JobTransitionError(from, to, `Unknown job status: ${to}`);
  if (!canTransitionJob(from, to)) throw new JobTransitionError(from, to);
  return true;
}

export function canTransitionAgent(from, to) {
  return Boolean(AGENT_TRANSITIONS[from]?.includes(to));
}

export function assertAgentTransition(from, to) {
  if (!AGENT_STATUSES.includes(to)) throw new AgentTransitionError(from, to);
  if (!canTransitionAgent(from, to)) throw new AgentTransitionError(from, to);
  return true;
}

export function createResearchJob({
  instrumentId,
  depth,
  timeframe = "1D",
  historyPeriod = "1Y",
  newsLookbackDays = 30,
  requestedModules,
  now = new Date().toISOString(),
  jobId = `research_${randomBytes(8).toString("hex")}`
}) {
  const job = {
    jobId,
    instrumentId,
    depth,
    timeframe,
    historyPeriod,
    newsLookbackDays,
    requestedModules,
    status: "CREATED",
    gate: null,
    createdAt: now,
    updatedAt: now,
    history: [{ from: null, to: "CREATED", at: now, reason: null }]
  };

  return researchJobSchema.parse(job);
}

/**
 * Move a job to its next status.
 *
 * Gate consistency is enforced: a job may only become BLOCKED with a BLOCKED
 * gate, and may only become COMPLETED/PARTIAL with a non-blocking gate. A gate
 * is mandatory for those three outcomes so the verdict can never be implied.
 */
export function transitionJob(job, nextStatus, { at = new Date().toISOString(), reason = null, gate } = {}) {
  assertJobTransition(job.status, nextStatus);

  const requiresGate = ["BLOCKED", "COMPLETED", "PARTIAL"].includes(nextStatus);

  if (requiresGate) {
    if (!gate) {
      throw new JobTransitionError(job.status, nextStatus, `A gate result is required to move a job to ${nextStatus}`);
    }
    if (nextStatus === "BLOCKED" && gate.verdict !== "BLOCKED") {
      throw new JobTransitionError(job.status, nextStatus, "A BLOCKED job requires a BLOCKED gate verdict");
    }
    if (nextStatus !== "BLOCKED" && gate.verdict === "BLOCKED") {
      throw new JobTransitionError(job.status, nextStatus, "A non-blocked job cannot carry a BLOCKED gate verdict");
    }
  }

  const updated = {
    ...job,
    status: nextStatus,
    gate: gate ?? job.gate ?? null,
    updatedAt: at,
    history: [...(job.history || []), { from: job.status, to: nextStatus, at, reason }]
  };

  return researchJobSchema.parse(updated);
}

/** Convenience: derive the outcome from the gate verdict. */
export function applyGate(job, gate, { at = new Date().toISOString(), reason = null, partial = false } = {}) {
  const target = gate.verdict === "BLOCKED" ? "BLOCKED" : partial ? "PARTIAL" : "COMPLETED";
  return transitionJob(job, target, { at, reason: reason ?? `gate:${gate.verdict}`, gate });
}
