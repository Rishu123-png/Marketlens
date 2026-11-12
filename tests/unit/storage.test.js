import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPool, databaseConfigured, sslOptions } from "../../server/storage/pg.js";
import { listMigrations, runMigrations } from "../../server/storage/migrations.js";
import { createPgJobStore } from "../../server/storage/pgJobStore.js";
import { addRevision, getReport, saveReport } from "../../server/storage/reports.js";
import {
  createFilesystemObjectStore,
  createS3ObjectStore,
  objectStorageStatus,
  signS3Request
} from "../../server/storage/objects.js";
import { storageStatus } from "../../server/storage/index.js";

/** Minimal pg-like client that records statements and returns canned rows. */
function stubClient({ rows = [], rowCount = 1 } = {}) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text: String(text).replace(/\s+/g, " ").trim(), params });
      if (/^\s*SELECT \* FROM research_jobs WHERE job_id/.test(String(text))) return { rows };
      return { rows: [], rowCount };
    }
  };
}

test("pool creation fails closed without DATABASE_URL and maps SSL modes", async () => {
  assert.equal(databaseConfigured({}), false);
  assert.equal(databaseConfigured({ DATABASE_URL: "postgres://x" }), true);
  assert.deepEqual(sslOptions({ DATABASE_SSL: "require" }), { rejectUnauthorized: true });
  assert.deepEqual(sslOptions({ DATABASE_SSL: "no-verify" }), { rejectUnauthorized: false });
  assert.equal(sslOptions({}), undefined);

  await assert.rejects(() => createPool({ env: {} }), /DATABASE_URL is not configured/);

  let captured = null;
  class FakePool {
    constructor(config) {
      captured = config;
    }
  }
  const pool = await createPool({ env: { DATABASE_URL: "postgres://u:p@db:5432/x" }, PoolClass: FakePool });
  assert.ok(pool instanceof FakePool);
  assert.equal(captured.connectionString, "postgres://u:p@db:5432/x");
  assert.equal(captured.application_name, "marketlens");
  assert.equal(captured.max, 5);
});

test("migrations are discovered in order and recorded once", async () => {
  const migrations = await listMigrations();
  assert.ok(migrations.length >= 1);
  assert.equal(migrations[0].version, "001_init");

  const executed = [];
  const client = {
    async query(text, params) {
      const sql = String(text).replace(/\s+/g, " ").trim();
      executed.push({ sql, params });
      if (/SELECT version FROM schema_migrations/.test(sql)) return { rows: [] };
      if (/SELECT version FROM schema_migrations/.test(sql)) return { rows: [] };
      if (sql.startsWith("SELECT")) return { rows: [] };
      return { rows: [], rowCount: 1 };
    }
  };

  const result = await runMigrations(client, { logger: null });
  assert.ok(result.applied.includes("001_init"));
  assert.ok(executed.some((entry) => /CREATE TABLE IF NOT EXISTS schema_migrations/.test(entry.sql)));
  assert.ok(executed.some((entry) => /CREATE TABLE IF NOT EXISTS research_jobs/.test(entry.sql)));
  assert.ok(executed.some((entry) => /INSERT INTO schema_migrations/.test(entry.sql)));
  assert.ok(executed.some((entry) => entry.sql === "COMMIT"));
});

test("pg job store creates a job and writes its first event", async () => {
  const client = stubClient();
  const store = createPgJobStore(client, { now: () => "2026-02-10T09:00:00.000Z" });

  const job = await store.create({ instrumentId: "IN-EQ-RELIANCE", depth: "quick" });
  assert.equal(job.status, "CREATED");
  assert.deepEqual(job.requestedModules, ["quote", "technical", "chart", "risk"]);

  const insert = client.calls.find((call) => call.text.startsWith("INSERT INTO research_jobs"));
  assert.ok(insert, "expected an insert into research_jobs");
  assert.equal(insert.params[0], job.jobId);
  assert.equal(insert.params[3], "1D");

  const event = client.calls.find((call) => call.text.startsWith("INSERT INTO research_job_events"));
  assert.equal(event.params[2], "CREATED");
});

test("pg job store maps a stored row including its transition history", async () => {
  const row = {
    job_id: "research_abcdefgh",
    instrument_id: "IN-EQ-INFY",
    depth: "standard",
    timeframe: "1D",
    history_period: "1Y",
    news_lookback_days: 30,
    requested_modules: ["quote", "news"],
    status: "QUEUED",
    gate: null,
    created_at: new Date("2026-02-10T09:00:00.000Z"),
    updated_at: new Date("2026-02-10T09:01:00.000Z")
  };

  const calls = [];
  const client = {
    async query(text, params) {
      const sql = String(text).replace(/\s+/g, " ").trim();
      calls.push({ sql, params });
      if (sql.startsWith("SELECT * FROM research_jobs")) return { rows: [row] };
      if (sql.startsWith("SELECT from_status")) {
        return {
          rows: [
            { from_status: null, to_status: "CREATED", at: row.created_at, reason: null },
            { from_status: "CREATED", to_status: "QUEUED", at: row.updated_at, reason: "queued" }
          ]
        };
      }
      return { rows: [] };
    }
  };

  const store = createPgJobStore(client);
  const job = await store.get("research_abcdefgh");
  assert.equal(job.instrumentId, "IN-EQ-INFY");
  assert.equal(job.createdAt, "2026-02-10T09:00:00.000Z");
  assert.equal(job.history.length, 2);
  assert.equal(job.history[1].to, "QUEUED");
});

test("pg claimNext uses SKIP LOCKED and returns null when the queue is empty", async () => {
  const empty = stubClient({ rows: [] });
  const emptyStore = createPgJobStore(empty);
  assert.equal(await emptyStore.claimNext(), null);

  const row = {
    job_id: "research_abcdefgh",
    instrument_id: "IN-EQ-INFY",
    depth: "quick",
    timeframe: "1D",
    history_period: "1Y",
    news_lookback_days: 30,
    requested_modules: ["quote"],
    status: "RUNNING",
    gate: null,
    created_at: new Date("2026-02-10T09:00:00.000Z"),
    updated_at: new Date("2026-02-10T09:02:00.000Z")
  };

  const client = {
    calls: [],
    async query(text, params) {
      const sql = String(text).replace(/\s+/g, " ").trim();
      this.calls.push({ sql, params });
      if (sql.startsWith("UPDATE research_jobs")) return { rows: [row], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }
  };

  const store = createPgJobStore(client);
  const claimed = await store.claimNext();

  assert.equal(claimed.jobId, "research_abcdefgh");
  const update = client.calls.find((call) => call.sql.startsWith("UPDATE research_jobs"));
  assert.match(update.sql, /FOR UPDATE SKIP LOCKED/);
  assert.ok(client.calls.some((call) => call.sql.startsWith("INSERT INTO research_job_events")));
});

test("reports are insert-only and revisions are recorded separately", async () => {
  const calls = [];
  const client = {
    async query(text, params) {
      const sql = String(text).replace(/\s+/g, " ").trim();
      calls.push({ sql, params });
      if (sql.startsWith("INSERT INTO reports")) return { rows: [{ report_id: params[0] }], rowCount: 1 };
      if (sql.startsWith("SELECT * FROM reports")) return { rows: [] };
      return { rows: [], rowCount: 1 };
    }
  };

  const report = {
    reportId: "report_abcdef1234567890",
    jobId: "research_abcdefgh",
    instrumentId: "IN-EQ-INFY",
    depth: "quick",
    sections: { executiveSummary: "x" },
    agentStatus: { chart: "COMPLETED" },
    evidenceIds: [],
    gate: { verdict: "PASS" },
    methodology: "m",
    createdAt: "2026-02-10T09:00:00.000Z"
  };

  const saved = await saveReport(client, { report, versions: { reportBuilder: "1.0.0" } });
  assert.equal(saved.inserted, true);
  const insert = calls.find((call) => call.sql.startsWith("INSERT INTO reports"));
  assert.match(insert.sql, /ON CONFLICT \(report_id\) DO NOTHING/);

  await addRevision(client, { reportId: report.reportId, reason: "provider correction" });
  assert.ok(calls.some((call) => call.sql.startsWith("INSERT INTO report_revisions")));
  assert.ok(!calls.some((call) => call.sql.startsWith("UPDATE reports")), "reports must never be updated in place");

  assert.equal(await getReport(client, report.reportId), null);
});

test("saveResult persists evidence from the raw evidence list only", async () => {
  const calls = [];
  const client = {
    async query(text, params) {
      calls.push({ sql: String(text).replace(/\s+/g, " ").trim(), params });
      return { rows: [], rowCount: 1 };
    }
  };

  const store = createPgJobStore(client);
  await store.saveResult("research_abcdefgh", {
    evidence: { items: [{ evidenceId: "ev-compact" }] },
    evidenceForStorage: {
      items: [
        {
          id: "ev-1",
          sourceType: "news",
          publisher: "Wire",
          url: "https://example.com/1",
          publishedAt: "2026-02-09T10:00:00.000Z",
          retrievedAt: "2026-02-10T08:50:00.000Z",
          excerpt: "x",
          verification: "reported",
          dedupeFingerprint: "abc123abc123"
        }
      ]
    }
  });

  const inserts = calls.filter((call) => call.sql.startsWith("INSERT INTO evidence_items"));
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].params[0], "ev-1");
  assert.equal(inserts[0].params[9], "abc123abc123");
  assert.ok(!calls.some((call) => call.params?.[0] === "ev-compact"));
});

test("pg store persists the result envelope and reads it back after a refresh", async () => {
  const calls = [];
  const reportRow = {
    report_id: "report_abcdef1234567890",
    job_id: "research_abcdefgh",
    instrument_id: "IN-EQ-INFY",
    depth: "quick",
    sections: { executiveSummary: "x" },
    agent_status: { chart: "COMPLETED" },
    evidence_ids: [],
    gate: { verdict: "PASS_WITH_WARNINGS" },
    methodology: "m",
    versions: { orchestrator: "1" },
    created_at: new Date("2026-02-10T09:00:00.000Z")
  };
  const client = {
    async query(text, params) {
      const sql = String(text).replace(/\s+/g, " ").trim();
      calls.push({ sql, params });
      if (sql.startsWith("SELECT * FROM reports")) return { rows: [reportRow] };
      if (sql.startsWith("SELECT status, gate, versions")) {
        return {
          rows: [
            {
              status: "COMPLETED",
              gate: { verdict: "PASS_WITH_WARNINGS" },
              versions: { orchestrator: "1" },
              data_warnings: ["single price source"],
              evidence: { items: [] },
              error: null,
              updated_at: new Date("2026-02-10T09:05:00.000Z")
            }
          ]
        };
      }
      return { rows: [], rowCount: 1 };
    }
  };

  const store = createPgJobStore(client);
  await store.saveResult("research_abcdefgh", {
    report: { ...reportRow, reportId: reportRow.report_id, jobId: "research_abcdefgh", instrumentId: "IN-EQ-INFY", depth: "quick", sections: {}, agentStatus: {}, evidenceIds: [], gate: { verdict: "PASS_WITH_WARNINGS" }, methodology: "m", createdAt: "2026-02-10T09:00:00.000Z" },
    gate: { verdict: "PASS_WITH_WARNINGS" },
    dataWarnings: ["single price source"],
    versions: { orchestrator: "1" },
    status: "COMPLETED"
  });
  assert.ok(calls.some((call) => call.sql.startsWith("INSERT INTO research_job_results")));

  const result = await store.getResult("research_abcdefgh");
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.report.reportId, reportRow.report_id);
  assert.deepEqual(result.dataWarnings, ["single price source"]);
  assert.equal(result.updatedAt, "2026-02-10T09:05:00.000Z");
});

test("pg retry is explicit, clears the gate and records the transition", async () => {
  const row = {
    job_id: "research_abcdefgh",
    instrument_id: "IN-EQ-INFY",
    depth: "quick",
    timeframe: "1D",
    history_period: "1Y",
    news_lookback_days: 30,
    requested_modules: ["quote"],
    status: "FAILED",
    gate: null,
    created_at: new Date("2026-02-10T09:00:00.000Z"),
    updated_at: new Date("2026-02-10T09:01:00.000Z")
  };
  const calls = [];
  const client = {
    async query(text, params) {
      const sql = String(text).replace(/\s+/g, " ").trim();
      calls.push({ sql, params });
      if (sql.startsWith("SELECT * FROM research_jobs")) return { rows: [row] };
      if (sql.startsWith("SELECT from_status")) return { rows: [] };
      return { rows: [], rowCount: 1 };
    }
  };
  const store = createPgJobStore(client, { now: () => "2026-02-10T10:00:00.000Z" });
  const retried = await store.retry("research_abcdefgh");
  assert.equal(retried.status, "QUEUED");
  assert.equal(retried.gate, null);
  assert.ok(calls.some((call) => call.sql.startsWith("INSERT INTO research_job_events")));
});

test("filesystem object store round-trips artefacts and blocks traversal", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "marketlens-objects-"));
  try {
    const store = createFilesystemObjectStore({ root });
    await store.putObject("reports/2026/report_abc.json", { hello: "world" });

    const read = await store.getObject("reports/2026/report_abc.json");
    assert.deepEqual(JSON.parse(read), { hello: "world" });

    await assert.rejects(() => store.getObject("../../etc/passwd"));
    assert.deepEqual(await store.list("missing"), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("s3 storage fails closed without credentials and status never claims verification", () => {
  assert.throws(() => createS3ObjectStore({ bucket: "", accessKeyId: "", secretAccessKey: "" }), /S3 storage requires/);

  const status = objectStorageStatus({ S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" });
  assert.equal(status.active, "s3");
  assert.equal(status.s3.verification, "unverified");

  const local = objectStorageStatus({});
  assert.equal(local.active, "filesystem");
});

test("sigv4 signing is deterministic and well formed", () => {
  const args = {
    method: "PUT",
    url: "https://s3.us-east-1.amazonaws.com/bucket/reports/a.json",
    body: "{\"a\":1}",
    region: "us-east-1",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secret",
    extraHeaders: { "content-type": "application/json" },
    now: new Date("2026-02-10T09:00:00.000Z")
  };

  const first = signS3Request(args);
  const second = signS3Request(args);

  assert.deepEqual(first, second);
  assert.equal(first["x-amz-date"], "20260210T090000Z");
  assert.match(first.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20260210\/us-east-1\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/);
  assert.equal(first["x-amz-content-sha256"].length, 64);
  assert.ok(first.authorization.includes("content-type"));
  assert.ok(first.authorization.includes("x-amz-date"));
});

test("s3 adapter sends signed PUT and GET requests", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(options.method === "GET" ? "{\"stored\":true}" : "", { status: 200 });
  };

  const store = createS3ObjectStore({
    bucket: "reports",
    region: "us-east-1",
    accessKeyId: "key",
    secretAccessKey: "secret",
    endpoint: "https://s3.example.com",
    fetchImpl,
    now: () => new Date("2026-02-10T09:00:00.000Z")
  });

  await store.putObject("2026/report.json", { ok: true });
  const read = await store.getObject("2026/report.json");

  assert.deepEqual(JSON.parse(read), { stored: true });
  assert.equal(calls[0].url, "https://s3.example.com/reports/2026/report.json");
  assert.equal(calls[0].options.method, "PUT");
  assert.match(calls[0].options.headers.authorization, /^AWS4-HMAC-SHA256/);
  assert.equal(calls[1].options.method, "GET");
});

test("storage status reports memory as local-only and postgres as unverified", () => {
  const local = storageStatus({});
  assert.equal(local.database.implementation, "memory");
  assert.equal(local.database.verification, "local-only");

  const durable = storageStatus({ DATABASE_URL: "postgres://x" });
  assert.equal(durable.database.implementation, "postgres");
  assert.equal(durable.database.verification, "implemented-unverified");
});
