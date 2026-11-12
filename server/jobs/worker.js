/**
 * Job runner.
 *
 * Executes one claimed research job end to end: the orchestrator gathers and
 * analyses the data, this module records the agent runs and the report, and the
 * job moves to COMPLETED / PARTIAL / BLOCKED / FAILED according to the
 * deterministic gate. A failure is stored with its reason; nothing is retried
 * silently.
 */

import { runResearch } from "../orchestrator/research.js";
import { getJobStore } from "./store.js";

export class JobRunner {
  constructor({ store = getJobStore(), research = runResearch, logger = console, now = () => new Date().toISOString() } = {}) {
    this.store = store;
    this.research = research;
    this.logger = logger;
    this.now = now;
  }

  /**
   * @param {string} jobId A job in QUEUED or RUNNING state.
   */
  async process(jobId) {
    let job = this.store.get(jobId);

    if (job.status !== "RUNNING") {
      job = this.store.transition(jobId, "RUNNING", { reason: "worker started job" });
    }

    try {
      const result = await this.research({
        instrument: job.instrumentId,
        depth: job.depth,
        jobId: job.jobId,
        onAgentRun: (agent, run) => this.store.saveAgentRuns(job.jobId, { [agent]: run })
      });

      this.store.saveResult(job.jobId, {
        report: result.report,
        gate: result.gate,
        agentRuns: result.agentRuns,
        dataWarnings: result.dataWarnings,
        evidence: result.evidence,
        quote: result.quote,
        candles: result.candles,
        versions: result.versions,
        status: result.status
      });

      const partial = result.status !== "COMPLETED";
      const updated = this.store.complete(job.jobId, result.gate, {
        partial,
        reason: `orchestrator finished with ${result.status}`
      });

      return { job: updated, result };
    } catch (error) {
      this.logger?.error?.(`research job ${job.jobId} failed: ${error instanceof Error ? error.message : error}`);
      this.store.saveResult(job.jobId, {
        error: error instanceof Error ? error.message : "Unknown failure",
        failedAt: this.now()
      });
      const updated = this.store.fail(job.jobId, error instanceof Error ? error.message : "Unknown failure");
      return { job: updated, error };
    }
  }
}

/** Drain up to `limit` queued jobs in the current process. */
export async function drainQueue({ store = getJobStore(), runner = new JobRunner({ store }), limit = 5 } = {}) {
  const processed = [];

  for (let index = 0; index < limit; index += 1) {
    const claimed = store.claimNext();
    if (!claimed) break;
    processed.push(await runner.process(claimed.jobId));
  }

  return processed;
}
