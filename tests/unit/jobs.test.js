import test from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryJobStore,
  JobNotFoundError,
  resetJobStoreForTests,
  setJobStoreForTests
} from "../../server/jobs/store.js";
import jobDetailHandler from "../../handlers/jobs/[jobId].js";
import { resetRateLimitsForTests } from "../../lib/server/rateLimit.js";
import { JobRunner, drainQueue } from "../../server/jobs/worker.js";
import {
  createMemoryQueue,
  publishToQStash,
  queueStatus,
  resetQueueForTests
} from "../../server/jobs/queue.js";
import { GATE_RULES_VERSION } from "../../shared/schemas/gate.js";

const gate = (verdict) => ({
  verdict,
  rulesVersion: GATE_RULES_VERSION,
  evaluatedAt: "2026-02-10T09:00:00.000Z",
  checks: [{ rule: "test", status: verdict === "BLOCKED" ? "block" : "pass", detail: verdict }],
  blocking: verdict === "BLOCKED" ? [{ rule: "test", message: "blocked" }] : [],
  warnings: verdict === "PASS_WITH_WARNINGS" ? [{ rule: "test", message: "warning" }] : []
});

function queuedJob(store, overrides = {}) {
  const job = store.create({ instrumentId: "IN-EQ-RELIANCE", depth: "quick", ...overrides });
  store.transition(job.jobId, "VALIDATING", { reason: "validated" });
  return store.transition(job.jobId, "QUEUED", { reason: "queued" });
}

test("store enforces lifecycle and gate consistency", () => {
  const store = new InMemoryJobStore();
  const job = store.create({ instrumentId: "IN-EQ-RELIANCE", depth: "standard" });

  assert.equal(job.status, "CREATED");
  assert.deepEqual(job.requestedModules, ["quote", "technical", "chart", "news", "risk"]);
  assert.throws(() => store.transition(job.jobId, "COMPLETED"), /Illegal research-job transition/);
  assert.throws(() => store.transition(job.jobId, "RUNNING"), /Illegal research-job transition/);

  store.transition(job.jobId, "VALIDATING");
  store.transition(job.jobId, "QUEUED");
  store.transition(job.jobId, "RUNNING");

  assert.throws(() => store.complete(job.jobId, null), /gate result is required/i);
  assert.throws(
    () => store.transition(job.jobId, "COMPLETED", { gate: gate("BLOCKED") }),
    /non-blocked job cannot carry a BLOCKED gate/i
  );
  const blocked = store.complete(job.jobId, gate("BLOCKED"));
  assert.equal(blocked.status, "BLOCKED");
  assert.equal(blocked.gate.verdict, "BLOCKED");
});

test("claimNext picks the oldest queued job and marks it running", () => {
  const store = new InMemoryJobStore();
  const first = queuedJob(store);
  const second = queuedJob(store);

  const claimed = store.claimNext();
  assert.equal(claimed.jobId, first.jobId);
  assert.equal(claimed.status, "RUNNING");
  assert.equal(store.get(second.jobId).status, "QUEUED");
  assert.equal(store.claimNext().jobId, second.jobId);
  assert.equal(store.claimNext(), null);
});

test("unknown job ids raise a 404-shaped error", () => {
  const store = new InMemoryJobStore();
  assert.throws(() => store.get("research_missing123"), (error) => {
    assert.ok(error instanceof JobNotFoundError);
    assert.equal(error.statusCode, 404);
    return true;
  });
});

test("only FAILED or BLOCKED jobs can be explicitly retried", () => {
  const store = new InMemoryJobStore();
  const failedJob = queuedJob(store);
  store.fail(failedJob.jobId, "provider exploded");
  assert.equal(store.get(failedJob.jobId).status, "FAILED");

  const retried = store.retry(failedJob.jobId);
  assert.equal(retried.status, "QUEUED");
  assert.equal(retried.gate, null);
  assert.equal(retried.history.at(-1).from, "FAILED");
  assert.equal(retried.history.at(-1).to, "QUEUED");
  assert.match(retried.history.at(-1).reason, /retry requested/);

  const completed = queuedJob(store);
  store.transition(completed.jobId, "RUNNING");
  store.complete(completed.jobId, gate("PASS"));
  assert.throws(() => store.retry(completed.jobId), /Only FAILED or BLOCKED jobs can be retried/);
});

test("worker records results and applies the gate verdict", async () => {
  const store = new InMemoryJobStore();
  const job = queuedJob(store);

  const research = async () => ({
    status: "COMPLETED",
    gate: gate("PASS_WITH_WARNINGS"),
    report: { reportId: "report_abcdef1234567890" },
    agentRuns: { chart: { agent: "chart", status: "COMPLETED" } },
    dataWarnings: [],
    evidence: null,
    quote: null,
    candles: null,
    versions: {}
  });

  const runner = new JobRunner({ store, research, logger: null });
  const outcome = await runner.process(job.jobId);

  assert.equal(outcome.job.status, "COMPLETED");
  assert.equal(outcome.job.gate.verdict, "PASS_WITH_WARNINGS");
  assert.equal(store.getResult(job.jobId).report.reportId, "report_abcdef1234567890");
});

test("worker marks a blocked gate as BLOCKED and a partial run as PARTIAL", async () => {
  const store = new InMemoryJobStore();
  const blockedJob = queuedJob(store);
  const partialJob = queuedJob(store);

  const blockedRunner = new JobRunner({
    store,
    logger: null,
    research: async () => ({ status: "FAILED", gate: gate("BLOCKED"), report: {}, agentRuns: {}, versions: {} })
  });
  assert.equal((await blockedRunner.process(blockedJob.jobId)).job.status, "BLOCKED");

  const partialRunner = new JobRunner({
    store,
    logger: null,
    research: async () => ({ status: "PARTIAL", gate: gate("PASS_WITH_WARNINGS"), report: {}, agentRuns: {}, versions: {} })
  });
  assert.equal((await partialRunner.process(partialJob.jobId)).job.status, "PARTIAL");
});

test("worker failures are stored as FAILED with their reason", async () => {
  const store = new InMemoryJobStore();
  const job = queuedJob(store);
  const runner = new JobRunner({
    store,
    logger: null,
    research: async () => {
      throw new Error("provider exploded");
    }
  });

  const outcome = await runner.process(job.jobId);
  assert.equal(outcome.job.status, "FAILED");
  assert.match(store.getResult(job.jobId).error, /provider exploded/);
});

test("drainQueue processes only queued jobs", async () => {
  const store = new InMemoryJobStore();
  queuedJob(store);
  queuedJob(store);

  const runner = new JobRunner({
    store,
    logger: null,
    research: async () => ({ status: "COMPLETED", gate: gate("PASS"), report: {}, agentRuns: {}, versions: {} })
  });

  const processed = await drainQueue({ store, runner, limit: 5 });
  assert.equal(processed.length, 2);
  assert.ok(store.list().every((job) => job.status === "COMPLETED"));
  assert.equal((await drainQueue({ store, runner, limit: 5 })).length, 0);
});

test("memory queue is FIFO and clearable", async () => {
  const queue = createMemoryQueue();
  await queue.enqueue({ jobId: "a" });
  await queue.enqueue({ jobId: "b" });
  assert.equal(queue.size(), 2);
  assert.equal((await queue.dequeue()).jobId, "a");
  assert.equal((await queue.dequeue()).jobId, "b");
  assert.equal(await queue.dequeue(), null);
  queue.clear();
  assert.equal(queue.size(), 0);
});

test("memory queue acknowledges only the matching delivery", async () => {
  const queue = createMemoryQueue();
  await queue.enqueue({ jobId: "a" });
  await queue.enqueue({ jobId: "b" });
  await queue.enqueue({ jobId: "a", retry: true });
  assert.equal(queue.acknowledge("missing"), false);
  assert.equal(queue.acknowledge("a"), true);
  assert.equal(queue.size(), 2);
  assert.equal((await queue.dequeue()).jobId, "b");
  assert.equal((await queue.dequeue()).retry, true);
});

test("qstash publish posts the job to the worker with a bearer token", async () => {
  let captured = null;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ messageId: "msg_123" }), { status: 200 });
  };

  const result = await publishToQStash(
    { jobId: "research_abcdefgh" },
    { token: "qstash-token", workerUrl: "https://worker.example.com/api/worker", fetchImpl }
  );

  assert.equal(result.queue, "qstash");
  assert.equal(result.messageId, "msg_123");
  assert.equal(captured.url, "https://qstash.upstash.io/v2/publish/https%3A%2F%2Fworker.example.com%2Fapi%2Fworker");
  assert.equal(captured.options.headers.authorization, "Bearer qstash-token");
  assert.equal(JSON.parse(captured.options.body).jobId, "research_abcdefgh");
});

test("qstash publish fails closed without configuration or on upstream error", async () => {
  await assert.rejects(() => publishToQStash({ jobId: "x" }, { token: "", workerUrl: "" }), /QSTASH_TOKEN/);
  await assert.rejects(
    () => publishToQStash({ jobId: "x" }, { token: "t", workerUrl: "http://worker.example.com" }),
    /must use HTTPS/
  );

  await assert.rejects(
    () =>
      publishToQStash(
        { jobId: "x" },
        {
          token: "t",
          workerUrl: "https://worker.example.com",
          fetchImpl: async () => new Response("nope", { status: 500 })
        }
      ),
    /QStash publish failed/
  );
});

test("queue status never claims verification", () => {
  const status = queueStatus({ QSTASH_TOKEN: "t", WORKER_URL: "https://worker" });
  assert.equal(status.active, "qstash");
  assert.equal(status.qstash.verification, "configured-unverified");

  const local = queueStatus({});
  assert.equal(local.active, "memory");
  assert.match(local.memory.warning, /process-local|cannot deliver jobs across serverless/);
});

test("resetQueueForTests returns an empty shared queue", async () => {
  const queue = resetQueueForTests();
  assert.equal(queue.size(), 0);
});

test("resetJobStoreForTests clears the shared store", () => {
  const store = resetJobStoreForTests();
  assert.equal(store.list().length, 0);
});

/** Wrap a store so every method returns a promise, like the PostgreSQL store. */
function asAsyncStore(store) {
  const methods = ["create", "get", "has", "list", "transition", "claimNext", "complete", "fail", "cancel", "saveAgentRuns", "getAgentRuns", "saveResult", "getResult"];
  const wrapped = { kind: "async-facade" };
  for (const method of methods) {
    wrapped[method] = async (...args) => store[method](...args);
  }
  return wrapped;
}

test("worker and drainQueue await an asynchronous store", async () => {
  const base = new InMemoryJobStore();
  const store = asAsyncStore(base);
  const job = await store.create({ instrumentId: "IN-EQ-INFY", depth: "quick" });
  await store.transition(job.jobId, "VALIDATING", { reason: "validated" });
  await store.transition(job.jobId, "QUEUED", { reason: "queued" });

  const runner = new JobRunner({
    store,
    logger: null,
    research: async ({ onAgentRun }) => {
      onAgentRun?.("chart", { agent: "chart", status: "COMPLETED" });
      return { status: "COMPLETED", gate: gate("PASS"), report: { reportId: "report_async123456789" }, agentRuns: {}, versions: {} };
    }
  });

  const processed = await drainQueue({ store, runner, limit: 1 });
  assert.equal(processed.length, 1);
  assert.equal(processed[0].job.status, "COMPLETED");
  assert.deepEqual(Object.keys(await store.getAgentRuns(job.jobId)), ["chart"]);
  assert.equal((await store.getResult(job.jobId)).report.reportId, "report_async123456789");
});

test("job detail endpoint works against an asynchronous store", async () => {
  resetRateLimitsForTests();
  const base = new InMemoryJobStore();
  const store = asAsyncStore(base);
  setJobStoreForTests(store);

  const job = await store.create({ instrumentId: "IN-EQ-INFY", depth: "quick" });
  await store.transition(job.jobId, "VALIDATING", { reason: "validated" });
  await store.transition(job.jobId, "QUEUED", { reason: "queued" });
  await store.saveAgentRuns(job.jobId, { chart: { agent: "chart", status: "COMPLETED", error: null } });

  const res = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader() {},
    json(body) {
      this.body = body;
      return this;
    }
  };

  await jobDetailHandler({ method: "GET", query: { jobId: job.jobId }, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.job.status, "QUEUED");
  assert.equal(res.body.agentRuns.chart.status, "COMPLETED");

  const deleted = { ...res, statusCode: 200, body: undefined };
  await jobDetailHandler({ method: "DELETE", query: { jobId: job.jobId }, headers: {} }, deleted);
  assert.equal(deleted.body.status, "CANCELLED");
  assert.equal(deleted.body.cancelled, true);

  setJobStoreForTests(new InMemoryJobStore());
});
