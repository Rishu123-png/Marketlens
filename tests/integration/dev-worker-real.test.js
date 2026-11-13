import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApiServer } from "../../scripts/api-server.js";
import { startDevWorker } from "../../scripts/dev-worker.js";
import { resetJobStoreForTests } from "../../server/jobs/store.js";
import { resetQueueForTests } from "../../server/jobs/queue.js";
import { resetRateLimitsForTests } from "../../lib/server/rateLimit.js";
import { canPublishReport } from "../../src/lib/researchGate.js";

// Exercise the actual local worker, orchestrator, gate and HTTP handler together.
// The public create endpoint correctly refuses jobs without AI credentials, so
// this test seeds a queued job directly to simulate a previously queued job.
test("the local worker processes a queued job with no credentials and the gate blocks publication", async () => {
  const keys = [
    "DATABASE_URL", "QSTASH_TOKEN", "WORKER_URL", "FMP_API_KEY", "TWELVE_DATA_API_KEY", "ALPHA_VANTAGE_API_KEY",
    "GROQ_API_KEY", "GROQ_API_KEY_CHART", "GROQ_API_KEY_TECHNICAL", "GROQ_API_KEY_NEWS",
    "GROQ_API_KEY_SENTIMENT", "GROQ_API_KEY_RISK", "GROQ_API_KEY_COORDINATOR"
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  const store = resetJobStoreForTests();
  const queue = resetQueueForTests();
  resetRateLimitsForTests();
  const server = createApiServer();
  const worker = startDevWorker({ intervalMs: 60_000, logger: null });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const refused = await fetch(`${base}/api/research`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol: "TCS", exchange: "NSE", depth: "quick" })
    });
    assert.equal(refused.status, 503);
    assert.match((await refused.json()).error, /not configured/i);
    assert.equal(store.list().length, 0);

    let job = store.create({ instrumentId: "IN-EQ-TCS", depth: "quick" });
    job = store.transition(job.jobId, "VALIDATING");
    job = store.transition(job.jobId, "QUEUED");
    await queue.enqueue({ jobId: job.jobId });
    await worker.tick();
    assert.equal(queue.size(), 0, "processed local deliveries should be acknowledged");

    const response = await fetch(`${base}/api/jobs/${encodeURIComponent(job.jobId)}`);
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.equal(detail.job.status, "BLOCKED");
    assert.equal(detail.job.gate.verdict, "BLOCKED");
    assert.equal(detail.report.gate.verdict, "BLOCKED");
    assert.equal(canPublishReport(detail.report, detail.job), false);
    assert.ok(detail.job.gate.blocking.length > 0);
    assert.equal(detail.dataSnapshot.quote, null);
    assert.equal(detail.dataSnapshot.candles, null);
    assert.ok(Object.keys(detail.agentRuns).length > 0);
    assert.ok(detail.job.history.some((event) => event.to === "RUNNING"));

    let cancelled = store.create({ instrumentId: "IN-EQ-TCS", depth: "quick" });
    cancelled = store.transition(cancelled.jobId, "VALIDATING");
    cancelled = store.transition(cancelled.jobId, "QUEUED");
    await queue.enqueue({ jobId: cancelled.jobId });
    const cancelledResponse = await fetch(`${base}/api/jobs/${encodeURIComponent(cancelled.jobId)}`, { method: "DELETE" });
    assert.equal(cancelledResponse.status, 200);
    assert.equal((await cancelledResponse.json()).status, "CANCELLED");
    assert.equal(queue.size(), 0, "cancelled local deliveries should not inflate queue depth");
  } finally {
    worker.stop();
    await new Promise((resolve) => server.close(resolve));
    resetJobStoreForTests();
    resetQueueForTests();
    resetRateLimitsForTests();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
