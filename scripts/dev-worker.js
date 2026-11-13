/**
 * Development-only background worker. The default in-memory job store belongs
 * to the API process, so a separate `npm run worker` cannot see its jobs.
 * This poller runs outside HTTP requests and reuses the normal JobRunner/gate.
 */
import { drainQueue } from "../server/jobs/worker.js";
import { resolveJobStore } from "../server/jobs/store.js";
import { getQueue } from "../server/jobs/queue.js";

async function pollLocalJobs() {
  const processed = await drainQueue({ store: await resolveJobStore(), limit: 3 });
  const queue = getQueue();
  if (queue.id === "memory") {
    for (const entry of processed) queue.acknowledge(entry.job?.jobId);
  }
  return processed;
}

export function startDevWorker({
  intervalMs = 2000,
  poll = pollLocalJobs,
  logger = console
} = {}) {
  let running = false;
  let stopped = false;

  async function tick() {
    if (stopped || running) return;
    running = true;
    try {
      const processed = await poll();
      for (const entry of processed || []) {
        logger?.info?.(`[dev worker] job ${entry.job?.jobId ?? "unknown"} → ${entry.job?.status ?? "error"}`);
      }
    } catch (error) {
      logger?.error?.(`[dev worker] drain failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return {
    tick,
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}
