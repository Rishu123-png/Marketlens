import test from "node:test";
import assert from "node:assert/strict";
import { runResearch } from "../../server/orchestrator/research.js";
import { buildResearchReport } from "../../server/reports/report.js";
import { resetUsageForTests } from "../../server/ai/usage.js";

const NOW = new Date("2026-02-10T09:00:00.000Z");

function quote(overrides = {}) {
  return {
    instrumentId: "IN-EQ-RELIANCE",
    symbol: "RELIANCE",
    price: 2890.5,
    change: 12.4,
    changePercent: 0.43,
    currency: "INR",
    provider: "fmp",
    source: "FMP",
    timestamp: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
    providerTimestamp: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
    retrievedAt: new Date(NOW.getTime() - 30 * 1000).toISOString(),
    quoteVerified: true,
    ...overrides
  };
}

function candles(count = 80) {
  const series = Array.from({ length: count }, (_, index) => {
    const close = 2800 + Math.sin(index / 7) * 30 + index * 1.5;
    return {
      time: new Date(Date.UTC(2026, 0, 1) + index * 86_400_000).toISOString().slice(0, 10),
      open: close - 4,
      high: close + 8,
      low: close - 8,
      close,
      volume: 1_000_000 + index * 1000,
      source: "Twelve Data"
    };
  });

  return {
    interval: "1day",
    candles: series,
    source: "Twelve Data",
    coverage: { from: series[0].time, to: series.at(-1).time, count, complete: true },
    droppedRows: 0,
    retrievedAt: new Date(NOW.getTime() - 2 * 60 * 1000).toISOString()
  };
}

function evidence(count = 5) {
  const items = Array.from({ length: count }, (_, index) => ({
    id: `ev-${index + 1}`,
    evidenceId: `ev-${index + 1}`,
    dedupeFingerprint: `fingerprint-${index + 1}`,
    sourceType: index === 0 ? "regulatory" : "news",
    publisher: "Example Wire",
    url: `https://example.com/${index + 1}`,
    publishedAt: "2026-02-09T10:00:00.000Z",
    retrievedAt: "2026-02-10T08:50:00.000Z",
    excerpt: "Reliance Industries reported quarterly results.",
    verification: "reported",
    duplicateCount: 1,
    injectionSignals: []
  }));

  return {
    items,
    counts: { fetched: count, accepted: count, returned: count, rejected: 0 },
    sources: [{ id: "official-rss", status: "ok", items: count }],
    limitations: ["Headlines and excerpts are reported claims from third parties, not verified facts"]
  };
}

const CHART_OUTPUT = {
  summary: "Price is range-bound with a mild upward bias.",
  observations: ["Higher lows on the daily series"],
  evidenceIds: [],
  confidence: "medium",
  limitations: ["Pattern detection is geometric"],
  structure: "Consolidation between support and resistance",
  trend: { label: "sideways", evidence: ["Higher lows"] },
  zones: [{ kind: "support", low: 2780, high: 2820, touches: 3, note: null }],
  patterns: [{ name: "ascending-triangle", status: "forming", direction: "bullish", note: null }],
  volumeObservations: ["Volume is near its 20-day baseline"],
  timeframeFindings: ["Daily structure only"]
};

function technicalOutput() {
  return {
    summary: "Momentum is neutral with moderate volatility.",
    observations: ["RSI near mid-range"],
    evidenceIds: [],
    confidence: "medium",
    limitations: ["Indicator history is limited to the supplied candles"],
    indicators: {
      rsi14: { value: 52.1, interpretation: "mid-range" },
      macd: { value: 3.4, interpretation: "mildly positive" },
      sma20: { value: 2860, interpretation: "price above the 20-day average" },
      atr14: { value: 42.5, interpretation: "moderate range" }
    },
    agreement: "mixed",
    conflicts: ["RSI neutral while MACD is positive"],
    timeframeNotes: ["Single timeframe supplied"]
  };
}

const RISK_OUTPUT = {
  summary: "Data quality is adequate with single-source price risk.",
  observations: ["Only one provider was available for the quote"],
  evidenceIds: [],
  confidence: "medium",
  limitations: ["No independent price cross-check"],
  dataQuality: { status: "degraded", warnings: ["Single price source"] },
  volatility: { level: "normal", note: "ATR within normal range" },
  conflicts: ["Technical and chart readings differ slightly"],
  uncertainty: "medium",
  publicationGate: "warn",
  gateReasons: ["Single price source"]
};

function coordinatorOutput() {
  const section = (body) => ({ status: "available", body });
  return {
    summary: "Research synthesised from chart, technical, news, sentiment and risk findings.",
    observations: ["Structure is range-bound"],
    evidenceIds: [],
    confidence: "medium",
    limitations: ["Research only"],
    sections: {
      summary: section("Summary body"),
      marketContext: section("Market context body"),
      chart: section("Chart body"),
      technical: section("Technical body"),
      news: section("News body"),
      sentiment: section("Sentiment body"),
      risk: section("Risk body"),
      conflicts: section("Conflicts body"),
      whatToMonitor: section("Monitor body"),
      sourcesAndMethodology: section("Sources body")
    },
    disagreements: ["Chart sees consolidation, technical sees mixed momentum"],
    scenarios: {
      bullish: { thesis: "Continuation above support.", evidenceIds: [], conditions: ["Volume expands"], uncertainty: "medium", invalidation: "Close below support" },
      bearish: { thesis: "Range breakdown risk.", evidenceIds: [], conditions: ["Support fails"], uncertainty: "medium", invalidation: "Reclaim of resistance" },
      neutral: { thesis: "Range persists.", evidenceIds: [], conditions: ["No breakout"], uncertainty: "low", invalidation: "Sustained trend" }
    },
    agentStatus: {
      chart: "COMPLETED",
      technical: "COMPLETED",
      news: "COMPLETED",
      sentiment: "COMPLETED",
      risk: "COMPLETED"
    }
  };
}

const NEWS_OUTPUT = {
  summary: "Quarterly results and a regulatory notice dominate the news flow.",
  observations: ["One regulatory item"],
  evidenceIds: ["ev-1"],
  confidence: "medium",
  limitations: ["Five items is a small sample"],
  events: [
    {
      id: "ev-1",
      title: "Regulatory notice published",
      publishedAt: "2026-02-09T10:00:00.000Z",
      publisher: "Example Wire",
      url: "https://example.com/1",
      category: "regulatory",
      summary: "A regulatory notice was published.",
      claimType: "confirmed"
    }
  ],
  significance: ["Regulatory items can change disclosure requirements"],
  gaps: ["No management commentary in the evidence"]
};

const SENTIMENT_OUTPUT = {
  summary: "Tone is mildly positive but the sample is thin.",
  observations: ["Results coverage dominates"],
  evidenceIds: ["ev-2"],
  confidence: "low",
  limitations: ["Small sample"],
  label: "positive",
  score: 0.35,
  drivers: ["Earnings coverage"],
  divergence: { detected: false, detail: "Tone broadly matches the price move" },
  coverage: { articles: 5, spanDays: 3 }
};

const DEFAULTS = {
  "Chart Agent (price structure)": CHART_OUTPUT,
  "Technical Agent (indicator interpretation)": technicalOutput(),
  "Risk Agent (data quality and uncertainty)": RISK_OUTPUT,
  "Coordinator Agent (synthesis)": coordinatorOutput(),
  "News Agent (events)": NEWS_OUTPUT,
  "Sentiment Agent (perception)": SENTIMENT_OUTPUT
};

function stubProvider(overrides = {}) {
  const calls = [];

  return {
    id: "stub",
    label: "Stub provider",
    isConfigured: () => true,
    calls,
    async completeJson({ messages }) {
      const system = messages.find((message) => message.role === "system").content;
      const role = system.match(/You are the ([^.]+) in Market Lens/)[1].trim();
      calls.push(role);

      const override = overrides[role];
      const output = override === undefined ? DEFAULTS[role] : override;

      return {
        content: typeof output === "string" ? output : JSON.stringify(output),
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        model: "stub-model",
        provider: "stub"
      };
    }
  };
}

function baseOptions(overrides = {}) {
  return {
    instrument: "RELIANCE",
    exchange: "NSE",
    depth: "quick",
    quote: quote(),
    candles: candles(),
    provider: stubProvider(),
    now: () => NOW,
    ...overrides
  };
}

test("quick research completes with deterministic facts and ordered agents", async () => {
  resetUsageForTests();
  const provider = stubProvider();
  const result = await runResearch(baseOptions({ provider }));

  assert.equal(result.instrumentId, "IN-EQ-RELIANCE");
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.depth, "quick");
  assert.equal(result.agentRuns.chart.status, "COMPLETED");
  assert.equal(result.agentRuns.technical.status, "COMPLETED");
  assert.equal(result.agentRuns.risk.status, "COMPLETED");
  assert.equal(result.agentRuns.coordinator.status, "COMPLETED");
  assert.equal(result.agentRuns.news, undefined, "news is not requested at quick depth");

  assert.equal(provider.calls.at(-1), "Coordinator Agent (synthesis)");
  assert.ok(provider.calls.indexOf("Risk Agent (data quality and uncertainty)") < provider.calls.indexOf("Coordinator Agent (synthesis)"));
  assert.equal(provider.calls.length, 4);

  assert.notEqual(result.gate.verdict, "BLOCKED");
  assert.equal(result.gate.rulesVersion, "1.0.0");
  assert.ok(result.chart.trend.label);
  assert.ok(result.indicators.rsi !== undefined);

  const report = result.report;
  assert.equal(report.sections.executiveSummary, "Summary body");
  assert.equal(report.sections.chart, "Chart body");
  assert.match(report.sections.sentiment, /does not request the sentiment module/);
  assert.match(report.sections.methodology, /Publication gate/);
  assert.ok(report.sections.sources.length > 0);
  assert.equal(report.gate.verdict, result.gate.verdict);
  assert.match(report.sections.scenarios, /Bullish scenario/);
  assert.match(report.sections.scenarios, /not forecasts/);

  assert.equal(result.runConfig.runId, result.runId);
  assert.equal(result.runConfig.instrument.exchange, "NSE");
  assert.equal(result.runConfig.agentConfig.coordinator.model, "stub-model");
  assert.equal(result.runConfig.candleRange.count, 80);
  assert.equal(result.dataSnapshot.candles.count, 80);
  assert.match(result.dataSnapshot.snapshotHash, /^[a-f0-9]{16}$/);
  assert.equal(result.reproducibility.replayable, true);
});

test("standard depth runs news and sentiment, and keeps their evidence", async () => {
  resetUsageForTests();
  const result = await runResearch(
    baseOptions({ depth: "standard", evidence: evidence(5), provider: stubProvider() })
  );

  assert.equal(result.depth, "standard");
  assert.equal(result.agentRuns.chart.status, "COMPLETED");
  assert.equal(result.agentRuns.news.status, "COMPLETED");
  assert.equal(result.agentRuns.sentiment, undefined);
  assert.equal(result.evidence.counts.returned, 5);
  assert.equal(result.evidenceForStorage.items.length, 5, "raw evidence is carried for persistence");
  assert.ok(result.evidenceForStorage.items.every((item) => item.dedupeFingerprint));
  assert.equal(result.report.evidenceIds.length, 5);
  assert.ok(result.report.sections.sources.some((line) => line.includes("ev-1")));
});

test("comprehensive depth runs all six agents", async () => {
  resetUsageForTests();
  const result = await runResearch(
    baseOptions({ depth: "comprehensive", evidence: evidence(6), provider: stubProvider() })
  );

  assert.deepEqual(Object.keys(result.agentRuns).sort(), [
    "chart",
    "coordinator",
    "news",
    "risk",
    "sentiment",
    "technical"
  ]);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.report.agentStatus.sentiment, "COMPLETED");
});

test("a missing specialist becomes SKIPPED, the gate blocks, and the section is removed", async () => {
  resetUsageForTests();
  const provider = stubProvider();
  const result = await runResearch(
    baseOptions({ depth: "standard", evidence: { items: [], counts: { fetched: 0, accepted: 0, returned: 0, rejected: 0 }, sources: [], limitations: [] }, provider })
  );

  assert.equal(result.agentRuns.news.status, "SKIPPED");
  assert.match(result.agentRuns.news.error, /Insufficient evidence/);
  assert.equal(result.gate.verdict, "BLOCKED");
  assert.ok(result.gate.blocking.some((finding) => finding.rule.startsWith("agent.news")));
  assert.match(result.report.sections.news, /Section unavailable/);
  assert.equal(result.status, "PARTIAL");
});

test("prohibited recommendation language fails the agent deterministically", async () => {
  resetUsageForTests();
  const provider = stubProvider({
    "Technical Agent (indicator interpretation)": {
      ...technicalOutput(),
      summary: "We recommend buying the stock now; the price target is 3200."
    }
  });

  const result = await runResearch(baseOptions({ provider }));
  assert.equal(result.agentRuns.technical.status, "FAILED");
  assert.match(result.agentRuns.technical.error, /prohibited language/);
  assert.equal(result.gate.verdict, "BLOCKED");
  assert.match(result.report.sections.technical, /Section unavailable/);
});

test("citing evidence that was never supplied fails the agent", async () => {
  resetUsageForTests();
  const provider = stubProvider({
    "News Agent (events)": { ...NEWS_OUTPUT, evidenceIds: ["ev-does-not-exist"] }
  });

  const result = await runResearch(
    baseOptions({ depth: "standard", evidence: evidence(3), provider })
  );

  assert.equal(result.agentRuns.news.status, "FAILED");
  assert.match(result.agentRuns.news.error, /unknown evidence id/);
});

test("invalid agent JSON is recorded as a failure, not repaired", async () => {
  resetUsageForTests();
  const provider = stubProvider({ "Chart Agent (price structure)": "{\"summary\": \"missing fields\"}" });

  const result = await runResearch(baseOptions({ provider }));
  assert.equal(result.agentRuns.chart.status, "FAILED");
  assert.ok(result.agentRuns.chart.error.length > 0);
  assert.equal(result.gate.verdict, "BLOCKED");
});

test("a failed coordinator falls back to specialist summaries", async () => {
  resetUsageForTests();
  const provider = stubProvider({ "Coordinator Agent (synthesis)": "not json at all" });

  const result = await runResearch(baseOptions({ provider }));
  assert.equal(result.agentRuns.coordinator.status, "FAILED");
  assert.match(result.report.sections.executiveSummary, /coordinator did not complete/i);
  assert.equal(result.report.sections.chart, CHART_OUTPUT.summary);
  assert.equal(result.report.sections.observations.length, 0);
});

test("missing quote blocks publication without inventing a price", async () => {
  resetUsageForTests();
  const options = baseOptions({ provider: stubProvider() });
  delete options.quote;

  const result = await runResearch({ ...options, secondaryProvider: undefined });
  assert.equal(result.quote, null);
  assert.equal(result.gate.verdict, "BLOCKED");
  assert.ok(result.gate.blocking.some((finding) => finding.rule === "quote.present"));
  assert.ok(result.report.sections.limitations.length > 0);
});

test("report builder rejects an unknown instrument id instead of publishing", () => {
  assert.throws(
    () =>
      buildResearchReport({
        instrument: { id: "not-an-instrument", symbol: "X" },
        depth: "quick",
        modules: ["quote", "technical", "chart", "risk"],
        agentRuns: {},
        gate: {
          verdict: "BLOCKED",
          rulesVersion: "1.0.0",
          evaluatedAt: NOW.toISOString(),
          checks: [{ rule: "test", status: "block", detail: "blocked" }],
          blocking: [{ rule: "test", message: "blocked" }],
          warnings: []
        },
        envelope: { evidence: { items: [] } }
      }),
    (error) => error.statusCode === 500
  );
});
