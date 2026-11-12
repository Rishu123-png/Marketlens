import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryJobStore, setJobStoreForTests } from "../../server/jobs/store.js";
import { ownerHash } from "../../server/jobs/access.js";
import { resetRateLimitsForTests } from "../../lib/server/rateLimit.js";
import replayHandler from "../../handlers/jobs/replay.js";
import { matchApiRoute } from "../../server/http/router.js";

const OWNER = "a".repeat(48);

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
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

function storedReport(jobId) {
  return {
    reportId: "report_abcdef1234567890",
    jobId,
    instrumentId: "IN-EQ-TCS",
    depth: "quick",
    sections: { executiveSummary: "Stored summary", scenarios: "Stored scenarios" },
    agentStatus: { chart: "COMPLETED" },
    evidenceIds: ["ev-1"],
    gate: { verdict: "PASS_WITH_WARNINGS" },
    methodology: "Stored methodology",
    createdAt: "2026-11-12T09:00:00.000Z"
  };
}

test("replay route is registered before the generic job detail route", () => {
  const match = matchApiRoute("/api/jobs/research_abcdefgh/replay");
  assert.equal(match.definition, "jobs/:jobId/replay");
  assert.equal(match.params.jobId, "research_abcdefgh");
});

test("replay serves stored report, evidence and run config without a fresh fetch", async () => {
  resetRateLimitsForTests();
  const store = new InMemoryJobStore();
  setJobStoreForTests(store);
  const job = store.create({ instrumentId: "IN-EQ-TCS", depth: "quick" });
  store.setOwner(job.jobId, ownerHash(OWNER));

  const report = storedReport(job.jobId);
  store.saveResult(job.jobId, {
    report,
    gate: report.gate,
    evidence: { items: [{ evidenceId: "ev-1", excerpt: "Stored excerpt" }] },
    runConfig: {
      runId: job.jobId,
      analysisTimestamp: "2026-11-12T09:00:00.000Z",
      instrument: { id: "IN-EQ-TCS", exchange: "NSE" },
      candleRange: { from: "2026-11-10", to: "2026-11-11", count: 2, interval: "1day" }
    },
    dataSnapshot: { snapshotHash: "abcdef1234567890", quote: { price: 4100 } },
    versions: { orchestrator: "1.0.0" }
  });

  const res = response();
  await replayHandler(
    { method: "GET", query: { jobId: job.jobId }, headers: { "x-owner-id": OWNER } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.replayable, true);
  assert.equal(res.body.replayed, true);
  assert.equal(res.body.source, "stored");
  assert.equal(res.body.report.reportId, report.reportId);
  assert.equal(res.body.runConfig.candleRange.count, 2);
  assert.equal(res.body.evidence.items[0].excerpt, "Stored excerpt");
  assert.match(res.body.note, /No provider or model was called/);
  assert.equal(res.headers["cache-control"], "private, no-store");
});

test("replay refuses when no stored report exists and never fabricates one", async () => {
  resetRateLimitsForTests();
  const store = new InMemoryJobStore();
  setJobStoreForTests(store);
  const job = store.create({ instrumentId: "IN-EQ-TCS", depth: "quick" });

  const res = response();
  await replayHandler({ method: "GET", query: { jobId: job.jobId }, headers: {} }, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.replayable, false);
  assert.match(res.body.reason, /will not fetch new data/);
  assert.equal(res.body.report, undefined);
});

test("replay hides another owner's job and rejects writes", async () => {
  resetRateLimitsForTests();
  const store = new InMemoryJobStore();
  setJobStoreForTests(store);
  const job = store.create({ instrumentId: "IN-EQ-TCS", depth: "quick" });
  store.setOwner(job.jobId, ownerHash(OWNER));
  store.saveResult(job.jobId, { report: storedReport(job.jobId) });

  const hidden = response();
  await replayHandler(
    { method: "GET", query: { jobId: job.jobId }, headers: { "x-owner-id": "b".repeat(48) } },
    hidden
  );
  assert.equal(hidden.statusCode, 404);

  const write = response();
  await replayHandler(
    { method: "POST", query: { jobId: job.jobId }, headers: { "x-owner-id": OWNER } },
    write
  );
  assert.equal(write.statusCode, 405);
  assert.equal(write.headers.allow, "GET");
});

test("pg result persistence writes run_config and data_snapshot", async () => {
  const { createPgJobStore } = await import("../../server/storage/pgJobStore.js");
  const calls = [];
  const client = {
    async query(text, params) {
      calls.push({ sql: String(text).replace(/\s+/g, " ").trim(), params });
      return { rows: [], rowCount: 1 };
    }
  };
  const store = createPgJobStore(client);
  await store.saveResult("research_abcdefgh", {
    gate: { verdict: "PASS_WITH_WARNINGS" },
    runConfig: { runId: "research_abcdefgh", analysisTimestamp: "2026-11-12T09:00:00.000Z" },
    dataSnapshot: { snapshotHash: "abcdef1234567890" },
    status: "COMPLETED"
  });

  const insert = calls.find((call) => call.sql.startsWith("INSERT INTO research_job_results"));
  assert.match(insert.sql, /run_config/);
  assert.match(insert.sql, /data_snapshot/);
  assert.match(insert.params[6], /2026-11-12T09:00:00.000Z/);
  assert.match(insert.params[7], /abcdef1234567890/);
});
