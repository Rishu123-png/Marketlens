#!/usr/bin/env node
/**
 * Research worker.
 *
 * Independently deployed process that polls the queue and runs research jobs
 * (O1: never inside a Vercel request). With QStash configured, the same
 * `JobRunner` is invoked by the HTTP handler in `api/worker.js`.
 *
 * Usage:
 *   node scripts/worker.js           # poll forever
 *   node scripts/worker.js --once    # drain the queue and exit
 */

import { drainQueue } from "../server/jobs/worker.js";
import { resolveJobStore } from "../server/jobs/store.js";

const once = process.argv.includes("--once");
const intervalMs = Number(process.env.WORKER_POLL_MS || 2000);
let stopping = false;

async function tick() {
  try {
    const processed = await drainQueue({ store: await resolveJobStore(), limit: 3 });
    for (const entry of processed) {
      console.log(
        `[worker] job ${entry.job?.jobId ?? "unknown"} → ${entry.job?.status ?? "error"}` +
          (entry.result?.gate ? ` (gate ${entry.result.gate.verdict})` : "")
      );
    }
  } catch (error) {
    console.error(`[worker] drain failed: ${error instanceof Error ? error.message : error}`);
  }
}

process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});

if (once) {
  await tick();
  process.exit(0);
}

console.log(`[worker] polling every ${intervalMs}ms`);
while (!stopping) {
  await tick();
  if (stopping) break;
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
console.log("[worker] stopped");
