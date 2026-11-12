/**
 * Research-job store.
 *
 * The interface is deliberately small so the in-memory implementation can be
 * swapped for PostgreSQL (see `server/storage/`) without touching the worker or
 * the API. Lifecycle rules come from `jobLifecycle.js`: no transition is
 * written that the state machine would reject.
 *
 * Known limitation: the memory store is process-local. It exists for local
 * development, tests and single-worker deployments. Production must configure
 * the PostgreSQL store, because a serverless instance cannot share memory with
 * the worker.
 */

import {
  applyGate,
  createResearchJob,
  isTerminalJobStatus,
  transitionJob
} from "../orchestrator/jobLifecycle.js";
import { REQUIRED_MODULES_BY_DEPTH } from "../../shared/schemas/research.js";

export class JobNotFoundError extends Error {
  constructor(jobId) {
    super(`Research job not found: ${jobId}`);
    this.name = "JobNotFoundError";
    this.statusCode = 404;
  }
}

export class InMemoryJobStore {
  constructor({ now = () => new Date().toISOString() } = {}) {
    this.now = now;
    this.jobs = new Map();
    this.results = new Map();
    this.agentRuns = new Map();
  }

  create({ instrumentId, depth, timeframe, historyPeriod, newsLookbackDays, jobId } = {}) {
    const job = createResearchJob({
      instrumentId,
      depth,
      requestedModules: REQUIRED_MODULES_BY_DEPTH[depth],
      timeframe,
      historyPeriod,
      newsLookbackDays,
      now: this.now(),
      ...(jobId ? { jobId } : {})
    });

    this.jobs.set(job.jobId, job);
    return job;
  }

  get(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) throw new JobNotFoundError(jobId);
    return job;
  }

  has(jobId) {
    return this.jobs.has(jobId);
  }

  list({ limit = 20, status = null } = {}) {
    return [...this.jobs.values()]
      .filter((job) => (status ? job.status === status : true))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, Math.min(Math.max(limit, 1), 100));
  }

  transition(jobId, status, options = {}) {
    const job = this.get(jobId);
    const updated = transitionJob(job, status, { at: options.at ?? this.now(), reason: options.reason ?? null, gate: options.gate });
    this.jobs.set(jobId, updated);
    return updated;
  }

  /** Queue → running claim. Returns null when nothing is waiting. */
  claimNext() {
    const next = [...this.jobs.values()]
      .filter((job) => job.status === "QUEUED")
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];

    if (!next) return null;
    return this.transition(next.jobId, "RUNNING", { reason: "worker claimed job" });
  }

  complete(jobId, gate, { partial = false, reason = null } = {}) {
    const job = this.get(jobId);
    const updated = applyGate(job, gate, { at: this.now(), reason, partial });
    this.jobs.set(jobId, updated);
    return updated;
  }

  fail(jobId, reason) {
    const job = this.get(jobId);
    if (isTerminalJobStatus(job.status)) return job;
    return this.transition(jobId, "FAILED", { reason: String(reason).slice(0, 500) });
  }

  cancel(jobId) {
    const job = this.get(jobId);
    if (isTerminalJobStatus(job.status)) return job;
    return this.transition(jobId, "CANCELLED", { reason: "cancelled by operator" });
  }

  saveAgentRuns(jobId, runs) {
    this.agentRuns.set(jobId, { ...(this.agentRuns.get(jobId) || {}), ...runs });
  }

  getAgentRuns(jobId) {
    return this.agentRuns.get(jobId) || {};
  }

  saveResult(jobId, result) {
    this.results.set(jobId, { ...result, storedAt: this.now() });
  }

  getResult(jobId) {
    return this.results.get(jobId) || null;
  }

  reset() {
    this.jobs.clear();
    this.results.clear();
    this.agentRuns.clear();
  }
}

let sharedStore = new InMemoryJobStore();

export function getJobStore() {
  return sharedStore;
}

/** Tests only: replace the shared store with a clean instance. */
export function resetJobStoreForTests() {
  sharedStore = new InMemoryJobStore();
  return sharedStore;
}

export function setJobStoreForTests(store) {
  sharedStore = store;
  return sharedStore;
}
