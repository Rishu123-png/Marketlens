import test from "node:test";
import assert from "node:assert/strict";
import { getInstrument } from "../../shared/instruments/catalog.js";
import {
  buildDataSnapshot,
  buildReplayPayload,
  buildRunConfig
} from "../../server/orchestrator/reproducibility.js";

const instrument = getInstrument("IN-EQ-TCS");
const quote = {
  instrumentId: "IN-EQ-TCS",
  symbol: "TCS",
  price: 4100,
  currency: "INR",
  provider: "fmp",
  providerTimestamp: "2026-11-12T09:30:00.000Z",
  retrievedAt: "2026-11-12T09:31:00.000Z"
};
const candles = {
  interval: "1day",
  provider: "fmp",
  source: "Financial Modeling Prep",
  retrievedAt: "2026-11-12T09:31:05.000Z",
  droppedRows: 1,
  coverage: { from: "2026-01-01", to: "2026-11-11", count: 2, complete: true },
  candles: [
    { time: "2026-11-10", open: 1, high: 2, low: 1, close: 2, volume: 10 },
    { time: "2026-11-11", open: 2, high: 3, low: 2, close: 3, volume: 12 }
  ]
};
const envelope = {
  generatedAt: "2026-11-12T09:32:00.000Z",
  instrument: { instrumentId: "IN-EQ-TCS" },
  evidence: {
    items: [{ evidenceId: "ev-1", publisher: "SEBI", publishedAt: "2026-11-11T10:00:00.000Z", sourceType: "regulatory" }],
    counts: { fetched: 1, accepted: 1, returned: 1, rejected: 0 },
    sources: [{ id: "official-rss", status: "ok" }],
    limitations: []
  },
  quality: { dataWarnings: ["single price source"], coverage: { catalogued: 160 } }
};
const gate = {
  verdict: "PASS_WITH_WARNINGS",
  rulesVersion: "1.0.0",
  checks: [{ rule: "test", status: "warn", detail: "single source" }],
  blocking: [],
  warnings: [{ rule: "single-source", message: "One provider" }]
};
const agentRuns = {
  chart: { status: "COMPLETED", provider: "groq", model: "openai/gpt-oss-120b", promptVersion: "chart.v1", schemaVersion: "1", attempts: 1, retries: 0 },
  technical: { status: "COMPLETED", provider: "groq", model: "openai/gpt-oss-120b", promptVersion: "technical.v1", schemaVersion: "1", attempts: 1, retries: 0 },
  risk: { status: "COMPLETED", provider: "groq", model: "openai/gpt-oss-120b", promptVersion: "risk.v1", schemaVersion: "1", attempts: 1, retries: 0 }
};
const report = { reportId: "report_abcdef1234567890", jobId: "research_abcdefgh" };

test("run configuration records identity, sources, timestamps, candle range and model settings", () => {
  const config = buildRunConfig({
    runId: "research_abcdefgh",
    jobId: "research_abcdefgh",
    instrument,
    depth: "standard",
    requestedModules: ["quote", "technical", "chart", "news", "risk"],
    market: { quote, crossQuotes: [], candles },
    envelope,
    gate,
    agentRuns,
    report,
    versions: { orchestrator: "1.0.0" },
    options: { candleLimit: 260, newsLookbackDays: 7 },
    analysisTimestamp: "2026-11-12T09:33:00.000Z"
  });

  assert.equal(config.runId, "research_abcdefgh");
  assert.equal(config.instrument.exchange, "NSE");
  assert.equal(config.instrument.currency, "INR");
  assert.equal(config.sourceProviders.quote, "fmp");
  assert.equal(config.dataTimestamps.quoteProvider, "2026-11-12T09:30:00.000Z");
  assert.deepEqual(config.candleRange, { from: "2026-11-10", to: "2026-11-11", count: 2, interval: "1day" });
  assert.equal(config.agentConfig.chart.model, "openai/gpt-oss-120b");
  assert.equal(config.toolPolicy.maxCallsPerAgentRun, 6);
  assert.equal(config.gate.verdict, "PASS_WITH_WARNINGS");
  assert.equal(config.gate.blocking, false);
  assert.equal(config.finalReportId, report.reportId);
  assert.equal(JSON.stringify(config).includes("GROQ_API_KEY"), false);
});

test("data snapshot stores the exact candles, evidence and a stable hash", () => {
  const snapshot = buildDataSnapshot({ market: { quote, candles, indicators: null, chart: null, structure: null }, envelope });

  assert.equal(snapshot.candles.count, 2);
  assert.equal(snapshot.candles.from, "2026-11-10");
  assert.equal(snapshot.candles.to, "2026-11-11");
  assert.equal(snapshot.candles.droppedRows, 1);
  assert.equal(snapshot.evidence.items[0].evidenceId, "ev-1");
  assert.match(snapshot.snapshotHash, /^[a-f0-9]{16}$/);

  const again = buildDataSnapshot({ market: { quote, candles }, envelope });
  assert.equal(again.snapshotHash, snapshot.snapshotHash);
});

test("replay uses stored report and data, and refuses to fabricate a missing report", () => {
  const config = buildRunConfig({
    runId: "research_abcdefgh",
    jobId: "research_abcdefgh",
    instrument,
    depth: "standard",
    requestedModules: ["quote"],
    market: { quote, candles },
    envelope,
    gate,
    agentRuns,
    report,
    versions: {},
    analysisTimestamp: "2026-11-12T09:33:00.000Z"
  });
  const dataSnapshot = buildDataSnapshot({ market: { quote, candles }, envelope });

  const payload = buildReplayPayload({
    job: { jobId: "research_abcdefgh", gate },
    result: { report, runConfig: config, dataSnapshot, evidence: envelope.evidence, gate },
    agentRuns
  });

  assert.equal(payload.replayable, true);
  assert.equal(payload.replayed, true);
  assert.equal(payload.source, "stored");
  assert.equal(payload.report.reportId, report.reportId);
  assert.equal(payload.runConfig.candleRange.count, 2);
  assert.equal(payload.dataSnapshot.snapshotHash.length, 16);
  assert.match(payload.note, /No provider or model was called/);

  const missing = buildReplayPayload({ job: { jobId: "research_abcdefgh" }, result: null });
  assert.equal(missing.replayable, false);
  assert.match(missing.reason, /will not fetch new data/);
});
