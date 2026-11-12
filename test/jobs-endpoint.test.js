import test from "node:test";
import assert from "node:assert/strict";
import researchHandler from "../handlers/research.js";
import jobsHandler from "../handlers/jobs.js";
import jobDetailHandler from "../handlers/jobs/[jobId].js";
import workerHandler from "../handlers/worker.js";
import { resetJobStoreForTests } from "../server/jobs/store.js";
import { resetQueueForTests } from "../server/jobs/queue.js";
import { resetRateLimitsForTests } from "../lib/server/rateLimit.js";

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

async function withEnvironment(values, callback) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function freshState() {
  resetRateLimitsForTests();
  resetJobStoreForTests();
  resetQueueForTests();
}

test("research creation refuses to queue a job when AI is not configured", async () => {
  freshState();
  const res = mockResponse();
  await researchHandler({ method: "POST", body: { symbol: "RELIANCE", depth: "quick" }, headers: {} }, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.configuration, "GROQ_API_KEY");
});

test("research creation validates depth and symbol", async () => {
  freshState();
  await withEnvironment({ GROQ_API_KEY: "test-key", QSTASH_TOKEN: undefined, WORKER_URL: undefined }, async () => {
    const badDepth = mockResponse();
    await researchHandler({ method: "POST", body: { symbol: "RELIANCE", depth: "deep" }, headers: {} }, badDepth);
    assert.equal(badDepth.statusCode, 400);

    const badSymbol = mockResponse();
    await researchHandler({ method: "POST", body: { symbol: "", depth: "quick" }, headers: {} }, badSymbol);
    assert.equal(badSymbol.statusCode, 400);

    const notPost = mockResponse();
    await researchHandler({ method: "GET", query: {}, headers: {} }, notPost);
    assert.equal(notPost.statusCode, 405);
  });
});

test("a queued job can be polled and cancelled", async () => {
  freshState();
  await withEnvironment({ GROQ_API_KEY: "test-key", QSTASH_TOKEN: undefined, WORKER_URL: undefined }, async () => {
    const created = mockResponse();
    await researchHandler({ method: "POST", body: { symbol: "RELIANCE", depth: "standard" }, headers: {} }, created);

    assert.equal(created.statusCode, 202);
    assert.match(created.body.jobId, /^research_[a-z0-9]{8,}$/);
    assert.equal(created.body.status, "QUEUED");
    assert.deepEqual(created.body.requestedModules, ["quote", "technical", "chart", "news", "risk"]);
    assert.equal(created.body.queue.queue, "memory");
    assert.match(created.body.note, /memory queue/);

    const polled = mockResponse();
    await jobDetailHandler({ method: "GET", query: { jobId: created.body.jobId }, headers: {} }, polled);
    assert.equal(polled.statusCode, 200);
    assert.equal(polled.body.job.status, "QUEUED");
    assert.equal(polled.body.report, null);
    assert.deepEqual(polled.body.agentRuns, {});

    const cancelled = mockResponse();
    await jobDetailHandler({ method: "DELETE", query: { jobId: created.body.jobId }, headers: {} }, cancelled);
    assert.equal(cancelled.statusCode, 200);
    assert.equal(cancelled.body.status, "CANCELLED");

    const missing = mockResponse();
    await jobDetailHandler({ method: "GET", query: { jobId: "research_doesnotexist" }, headers: {} }, missing);
    assert.equal(missing.statusCode, 404);
  });
});

test("job list returns newest jobs with gate verdicts", async () => {
  freshState();
  await withEnvironment({ GROQ_API_KEY: "test-key", QSTASH_TOKEN: undefined, WORKER_URL: undefined }, async () => {
    const created = mockResponse();
    await researchHandler({ method: "POST", body: { symbol: "INFY", depth: "quick" }, headers: {} }, created);

    const list = mockResponse();
    await jobsHandler({ query: {}, headers: {} }, list);

    assert.equal(list.statusCode, 200);
    assert.equal(list.body.jobs.length, 1);
    assert.equal(list.body.jobs[0].jobId, created.body.jobId);
    assert.equal(list.body.jobs[0].status, "QUEUED");
    assert.equal(list.body.queue.active, "memory");
  });
});

test("worker endpoint requires a configured secret and a matching header", async () => {
  freshState();

  const unconfigured = mockResponse();
  await workerHandler({ method: "POST", body: { jobId: "research_x" }, headers: {} }, unconfigured);
  assert.equal(unconfigured.statusCode, 503);
  assert.deepEqual(unconfigured.body.configuration, ["WORKER_SECRET", "QSTASH_CURRENT_SIGNING_KEY"]);

  await withEnvironment({ WORKER_SECRET: "worker-secret" }, async () => {
    const unauthorized = mockResponse();
    await workerHandler({ method: "POST", body: { jobId: "research_x" }, headers: { "x-worker-secret": "wrong" } }, unauthorized);
    assert.equal(unauthorized.statusCode, 401);

    const unknownJob = mockResponse();
    await workerHandler(
      { method: "POST", body: { jobId: "research_missing" }, headers: { "x-worker-secret": "worker-secret" } },
      unknownJob
    );
    assert.equal(unknownJob.statusCode, 404);
  });
});

test("an owned research job is invisible to another browser identity", async () => {
  freshState();
  await withEnvironment({ GROQ_API_KEY: "test-key", QSTASH_TOKEN: undefined, WORKER_URL: undefined }, async () => {
    const ownerA = "a".repeat(48);
    const ownerB = "b".repeat(48);

    const created = mockResponse();
    await researchHandler(
      { method: "POST", body: { symbol: "TCS", depth: "quick" }, headers: { "x-owner-id": ownerA } },
      created
    );
    assert.equal(created.statusCode, 202);

    const asOwner = mockResponse();
    await jobDetailHandler(
      { method: "GET", query: { jobId: created.body.jobId }, headers: { "x-owner-id": ownerA } },
      asOwner
    );
    assert.equal(asOwner.statusCode, 200);

    const asStranger = mockResponse();
    await jobDetailHandler(
      { method: "GET", query: { jobId: created.body.jobId }, headers: { "x-owner-id": ownerB } },
      asStranger
    );
    assert.equal(asStranger.statusCode, 404, "a stranger must not be told the job exists");

    const anonymous = mockResponse();
    await jobDetailHandler({ method: "GET", query: { jobId: created.body.jobId }, headers: {} }, anonymous);
    assert.equal(anonymous.statusCode, 404);

    const ownerList = mockResponse();
    await jobsHandler({ query: {}, headers: { "x-owner-id": ownerA } }, ownerList);
    assert.equal(ownerList.body.jobs.length, 1);

    const strangerList = mockResponse();
    await jobsHandler({ query: {}, headers: { "x-owner-id": ownerB } }, strangerList);
    assert.equal(strangerList.body.jobs.length, 0);

    const anonymousList = mockResponse();
    await jobsHandler({ query: {}, headers: {} }, anonymousList);
    assert.equal(anonymousList.body.jobs.length, 0, "anonymous listing must not expose owned jobs");
  });
});
