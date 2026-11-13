import test from "node:test";
import assert from "node:assert/strict";
import { startDevWorker } from "../../scripts/dev-worker.js";
import { InMemoryJobStore } from "../../server/jobs/store.js";
import { drainQueue } from "../../server/jobs/worker.js";

test("the development worker can claim jobs in the API's in-memory store", async () => {
  const store = new InMemoryJobStore();
  const job = store.create({ instrumentId: "IN-EQ-TCS", depth: "quick" });
  store.transition(job.jobId, "VALIDATING");
  store.transition(job.jobId, "QUEUED");
  const seen = [];
  const runner = {
    async process(id) {
      seen.push(id);
      store.fail(id, "test-only worker outcome");
      return { job: store.get(id) };
    }
  };
  const worker = startDevWorker({
    intervalMs: 60_000,
    poll: () => drainQueue({ store, runner }),
    logger: null
  });
  try {
    await worker.tick();
    assert.deepEqual(seen, [job.jobId]);
    assert.equal(store.get(job.jobId).status, "FAILED");
    await worker.tick();
    assert.equal(seen.length, 1);
  } finally {
    worker.stop();
  }
});

test("the development worker never overlaps polls and stops cleanly", async () => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const worker = startDevWorker({
    intervalMs: 60_000,
    poll: async () => { calls += 1; await pending; return []; },
    logger: null
  });
  const first = worker.tick();
  await worker.tick();
  assert.equal(calls, 1);
  release();
  await first;
  worker.stop();
  await worker.tick();
  assert.equal(calls, 1);
});
