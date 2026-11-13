import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryJobStore } from "../../server/jobs/store.js";
import { JobRunner } from "../../server/jobs/worker.js";
import { runResearch } from "../../server/orchestrator/research.js";
import { canPublishReport } from "../../src/lib/researchGate.js";

const NOW = new Date("2026-02-10T09:00:00.000Z");

function candles(count = 45) {
  const series = Array.from({ length: count }, (_, index) => {
    const close = 2800 + Math.sin(index / 6) * 20 + index;
    return {
      time: new Date(Date.UTC(2026, 0, 1) + index * 86_400_000).toISOString().slice(0, 10),
      open: close - 3,
      high: close + 6,
      low: close - 6,
      close,
      volume: 900_000 + index * 500,
      source: "Twelve Data"
    };
  });

  return {
    interval: "1day",
    candles: series,
    source: "Twelve Data",
    coverage: { count, complete: true, from: series[0].time, to: series.at(-1).time },
    droppedRows: 0
  };
}

const QUOTE = {
  instrumentId: "IN-EQ-RELIANCE",
  price: 2890.5,
  change: 10,
  changePercent: 0.35,
  currency: "INR",
  provider: "fmp",
  quoteVerified: true,
  timestamp: "2026-02-10T08:00:00.000Z",
  providerTimestamp: "2026-02-10T08:00:00.000Z",
  retrievedAt: "2026-02-10T08:59:30.000Z"
};

const OUTPUTS = {
  "Chart Agent (price structure)": {
    summary: "Range-bound with a mild upward bias.",
    observations: [],
    evidenceIds: [],
    confidence: "medium",
    limitations: [],
    structure: "Consolidation",
    trend: { label: "sideways", evidence: [] },
    zones: [],
    patterns: [],
    volumeObservations: [],
    timeframeFindings: []
  },
  "Technical Agent (indicator interpretation)": {
    summary: "Momentum is neutral.",
    observations: [],
    evidenceIds: [],
    confidence: "medium",
    limitations: [],
    indicators: { rsi14: { value: 51.2, interpretation: "mid-range" } },
    agreement: "mixed",
    conflicts: [],
    timeframeNotes: []
  },
  "Risk Agent (data quality and uncertainty)": {
    summary: "Adequate data with single-source price risk.",
    observations: [],
    evidenceIds: [],
    confidence: "medium",
    limitations: [],
    dataQuality: { status: "degraded", warnings: ["Single price source"] },
    volatility: { level: "normal", note: null },
    conflicts: [],
    uncertainty: "medium",
    publicationGate: "warn",
    gateReasons: []
  },
  "News Agent (events)": {
    summary: "One company event was reported.",
    observations: [],
    evidenceIds: ["ev-1"],
    confidence: "medium",
    limitations: [],
    events: [
      {
        id: "ev-1",
        title: "Company publishes an update",
        publishedAt: "2026-02-09T10:00:00.000Z",
        publisher: "Wire",
        url: "https://example.com/1",
        category: "company",
        summary: "A company update was reported.",
        claimType: "reported"
      }
    ],
    significance: [],
    gaps: []
  },
  "Sentiment Agent (perception)": {
    summary: "Tone is neutral.",
    observations: [],
    evidenceIds: ["ev-1"],
    confidence: "low",
    limitations: [],
    label: "neutral",
    score: 0,
    drivers: [],
    divergence: null,
    coverage: { articles: 1, spanDays: 1 }
  },
  "Coordinator Agent (synthesis)": {
    summary: "Synthesised research.",
    observations: ["Range-bound"],
    evidenceIds: [],
    confidence: "medium",
    limitations: ["Research only"],
    sections: Object.fromEntries(
      [
        "summary",
        "marketContext",
        "chart",
        "technical",
        "news",
        "sentiment",
        "risk",
        "conflicts",
        "whatToMonitor",
        "sourcesAndMethodology"
      ].map((key) => [key, { status: "available", body: `${key} body` }])
    ),
    disagreements: [],
    scenarios: {
      bullish: { thesis: "Upside continuation.", evidenceIds: [], conditions: ["Volume expands"], uncertainty: "medium", invalidation: "Support fails" },
      bearish: { thesis: "Downside risk.", evidenceIds: [], conditions: ["Resistance holds"], uncertainty: "medium", invalidation: "Breakout" },
      neutral: { thesis: "Range persists.", evidenceIds: [], conditions: ["No breakout"], uncertainty: "low", invalidation: "Trend emerges" }
    },
    agentStatus: { chart: "COMPLETED", technical: "COMPLETED", risk: "COMPLETED" }
  }
};

const EVIDENCE = {
  items: [
    {
      id: "ev-1",
      sourceType: "news",
      publisher: "Wire",
      url: "https://example.com/1",
      publishedAt: "2026-02-09T10:00:00.000Z",
      retrievedAt: "2026-02-10T08:50:00.000Z",
      excerpt: "A company update was reported.",
      verification: "reported",
      dedupeFingerprint: "abc123abc123"
    }
  ],
  counts: { fetched: 1, accepted: 1, returned: 1, rejected: 0 },
  sources: ["Wire"],
  limitations: []
};

function stubProvider() {
  return {
    id: "stub",
    label: "stub",
    isConfigured: () => true,
    async completeJson({ messages }) {
      const system = messages.find((message) => message.role === "system").content;
      const role = system.match(/You are the ([^.]+) in Market Lens/)[1].trim();
      return {
        content: JSON.stringify(OUTPUTS[role]),
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        model: "stub-model",
        provider: "stub"
      };
    }
  };
}

test("worker + orchestrator produce a persisted, schema-valid report", async () => {
  const store = new InMemoryJobStore();
  const job = store.create({ instrumentId: "IN-EQ-RELIANCE", depth: "quick" });
  store.transition(job.jobId, "VALIDATING", { reason: "validated" });
  store.transition(job.jobId, "QUEUED", { reason: "queued" });

  const runner = new JobRunner({
    store,
    logger: null,
    now: () => NOW.toISOString(),
    research: (options) =>
      runResearch({
        ...options,
        quote: QUOTE,
        candles: candles(),
        evidence: null,
        provider: stubProvider(),
        now: () => NOW
      })
  });

  const outcome = await runner.process(job.jobId);

  assert.equal(outcome.job.status, "COMPLETED", "gate is not blocking for this fixture");
  assert.equal(outcome.job.gate.verdict, "PASS_WITH_WARNINGS");
  assert.equal(outcome.job.gate.blocking.length, 0);

  const stored = store.getResult(job.jobId);
  assert.ok(stored.report, "the report is persisted with the job");
  assert.equal(stored.report.jobId, job.jobId);
  assert.equal(stored.report.sections.executiveSummary, "summary body");
  assert.equal(stored.report.sections.sentiment.includes("does not request"), true);
  assert.ok(stored.report.methodology.includes("Publication gate"));
  assert.equal(stored.report.gate.verdict, "PASS_WITH_WARNINGS");
  assert.equal(canPublishReport(stored.report, outcome.job), true, "the UI accepts the actual validated job and report gates");

  const runs = store.getAgentRuns(job.jobId);
  assert.deepEqual(Object.keys(runs).sort(), ["chart", "coordinator", "risk", "technical"]);
  assert.ok(Object.values(runs).every((run) => run.status === "COMPLETED"));
});

test("comprehensive research executes all six agents and persists the report", async () => {
  const store = new InMemoryJobStore();
  const job = store.create({ instrumentId: "IN-EQ-RELIANCE", depth: "comprehensive" });
  store.transition(job.jobId, "VALIDATING", { reason: "validated" });
  store.transition(job.jobId, "QUEUED", { reason: "queued" });

  const runner = new JobRunner({
    store,
    logger: null,
    now: () => NOW.toISOString(),
    research: (options) =>
      runResearch({
        ...options,
        quote: QUOTE,
        candles: candles(),
        evidence: EVIDENCE,
        provider: stubProvider(),
        now: () => NOW
      })
  });

  const outcome = await runner.process(job.jobId);
  const runs = store.getAgentRuns(job.jobId);

  assert.deepEqual(Object.keys(runs).sort(), [
    "chart",
    "coordinator",
    "news",
    "risk",
    "sentiment",
    "technical"
  ]);
  assert.ok(Object.values(runs).every((run) => run.status === "COMPLETED"));
  assert.equal(outcome.job.status, "COMPLETED");
  assert.equal(outcome.result.status, "COMPLETED");
  assert.ok(store.getResult(job.jobId).report.sections.executiveSummary);
  assert.equal(store.getResult(job.jobId).report.jobId, job.jobId);
});
