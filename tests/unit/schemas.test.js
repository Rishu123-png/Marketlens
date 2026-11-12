import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_ASSET_TYPES,
  agentRunSchema,
  analysisReportSchema,
  candleSchema,
  evidenceSchema,
  gateResultSchema,
  instrumentSchema,
  quoteSchema,
  researchJobSchema,
  researchReportSchema
} from "../../shared/schemas/index.js";

const NOW = "2026-11-12T10:00:00.000Z";

const validInstrument = {
  id: "IN-EQ-RELIANCE",
  symbol: "RELIANCE",
  name: "Reliance Industries Ltd",
  exchange: "NSE",
  country: "IN",
  currency: "INR",
  assetType: "equity",
  sector: "Energy"
};

const validQuote = {
  mode: "verified",
  quoteVerified: true,
  instrumentId: "IN-EQ-RELIANCE",
  symbol: "RELIANCE",
  displaySymbol: "RELIANCE",
  exchange: "NSE",
  currency: "INR",
  assetType: "equity",
  price: 1450.5,
  change: 12.3,
  changePercent: 0.86,
  dayHigh: 1455,
  dayLow: 1436,
  volume: 1234567,
  source: "Twelve Data",
  provider: "twelve",
  updatedAt: NOW,
  retrievedAt: NOW,
  providerTimestamp: "2026-11-12T09:58:00.000Z",
  freshness: "verified"
};

const validGate = {
  verdict: "PASS",
  rulesVersion: "1.0.0",
  evaluatedAt: NOW,
  checks: [{ rule: "quote.present", status: "pass", detail: "ok" }],
  blocking: [],
  warnings: []
};

const validCandle = {
  time: "2026-11-11",
  open: 1440,
  high: 1455,
  low: 1436,
  close: 1450,
  volume: 1000,
  source: "Twelve Data"
};

const validEvidence = {
  id: "ev_news_1",
  sourceType: "news",
  publisher: "Example Financial",
  url: "https://example.com/story",
  publishedAt: "2026-11-11T06:00:00.000Z",
  retrievedAt: NOW,
  instrumentIds: ["IN-EQ-RELIANCE"],
  excerpt: "Company reported results.",
  verification: "reported",
  dedupeFingerprint: "abcdef0123456789"
};

const validAgentRun = {
  agent: "technical",
  status: "COMPLETED",
  researchJobId: "research_abcdef12",
  instrumentId: "IN-EQ-RELIANCE",
  startedAt: NOW,
  completedAt: NOW,
  durationMs: 1200,
  attempts: 1,
  retries: 0,
  provider: "groq",
  model: "configured-model",
  promptVersion: "1.0.0",
  schemaVersion: "1.0.0",
  output: { summary: "ok" },
  error: null,
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
};

const validJob = {
  jobId: "research_abcdef12",
  instrumentId: "IN-EQ-RELIANCE",
  depth: "quick",
  timeframe: "1D",
  historyPeriod: "1Y",
  newsLookbackDays: 30,
  requestedModules: ["quote", "technical", "chart", "risk"],
  status: "CREATED",
  gate: null,
  createdAt: NOW,
  updatedAt: NOW,
  history: [{ from: null, to: "CREATED", at: NOW, reason: null }]
};

const validReport = {
  reportId: "report_abcdef12",
  jobId: "research_abcdef12",
  instrumentId: "IN-EQ-RELIANCE",
  depth: "quick",
  sections: {
    executiveSummary: "Summary",
    instrument: "RELIANCE / NSE",
    marketContext: "Context",
    chart: "Chart",
    technical: "Technical",
    news: "Unavailable",
    sentiment: "Unavailable",
    risk: "Risk",
    conflicts: [],
    observations: ["a"],
    limitations: "Limitations",
    sources: ["ev_1"],
    methodology: "Deterministic indicators + Groq interpretation"
  },
  agentStatus: { technical: "COMPLETED", chart: "COMPLETED", risk: "COMPLETED" },
  evidenceIds: ["ev_1"] ,
  gate: validGate,
  methodology: "Deterministic indicators first; AI interprets only.",
  createdAt: NOW
};

const validAnalysis = {
  headline: "Neutral",
  summary: "Summary.",
  marketRead: "Read.",
  strengths: ["a"],
  risks: ["b"],
  whatToMonitor: ["c", "d"],
  limitations: "Limited.",
  dataIntegrity: "Provider metrics only."
};

test("instrument schema accepts a catalog instrument and rejects bad identity", () => {
  assert.equal(instrumentSchema.safeParse(validInstrument).success, true);

  assert.equal(instrumentSchema.safeParse({ ...validInstrument, id: "reliance" }).success, false);
  assert.equal(instrumentSchema.safeParse({ ...validInstrument, currency: "rupees" }).success, false);
  assert.equal(instrumentSchema.safeParse({ ...validInstrument, assetType: "stock" }).success, false);
  assert.equal(instrumentSchema.safeParse({ ...validInstrument, country: "IND" }).success, false);

  const { id, ...withoutId } = validInstrument;
  assert.equal(instrumentSchema.safeParse(withoutId).success, false);

  // Unknown extra keys are tolerated (providers add fields), values are still typed.
  assert.equal(instrumentSchema.safeParse({ ...validInstrument, extra: 1 }).success, true);
});

test("instrument asset types are broader than the activated set", () => {
  const bond = instrumentSchema.safeParse({
    ...validInstrument,
    id: "US-BOND-UST10Y",
    assetType: "bond"
  });
  assert.equal(bond.success, true, "the model must be able to represent future asset classes");
  assert.deepEqual(ACTIVE_ASSET_TYPES, ["equity", "index", "etf"], "only these may be exposed today");
});

test("quote schema enforces the verified-price invariant", () => {
  assert.equal(quoteSchema.safeParse(validQuote).success, true);

  assert.equal(
    quoteSchema.safeParse({ ...validQuote, price: null }).success,
    false,
    "a verified quote without a price is a contract violation"
  );

  assert.equal(
    quoteSchema.safeParse({ ...validQuote, quoteVerified: false, price: null }).success,
    true,
    "an explicitly unverified quote may carry no price"
  );

  assert.equal(quoteSchema.safeParse({ ...validQuote, dayHigh: 1400, dayLow: 1436 }).success, false);
  assert.equal(quoteSchema.safeParse({ ...validQuote, mode: "example" }).success, false);
  assert.equal(quoteSchema.safeParse({ ...validQuote, freshness: "stale" }).success, false);
});

test("candle schema validates OHLC relationships", () => {
  assert.equal(candleSchema.safeParse(validCandle).success, true);
  assert.equal(candleSchema.safeParse({ ...validCandle, high: 1400 }).success, false, "high below low");
  assert.equal(candleSchema.safeParse({ ...validCandle, open: 1500 }).success, false, "open outside range");
  assert.equal(candleSchema.safeParse({ ...validCandle, close: 1400 }).success, false, "close outside range");
  assert.equal(candleSchema.safeParse({ ...validCandle, volume: null }).success, true);
  assert.equal(candleSchema.safeParse({ ...validCandle, adjusted: true }).success, true);
});

test("evidence schema requires a retrievable source and consistent timestamps", () => {
  assert.equal(evidenceSchema.safeParse(validEvidence).success, true);

  const noUrl = evidenceSchema.safeParse({ ...validEvidence, url: null });
  assert.equal(noUrl.success, false);
  assert.match(noUrl.error.issues[0].message, /retrievable source/i);

  assert.equal(
    evidenceSchema.safeParse({
      ...validEvidence,
      publishedAt: "2026-11-12T11:00:00.000Z",
      retrievedAt: NOW
    }).success,
    false,
    "publication cannot postdate retrieval"
  );

  assert.equal(evidenceSchema.safeParse({ ...validEvidence, sourceType: "rumour" }).success, false);
  assert.equal(evidenceSchema.safeParse({ ...validEvidence, instrumentIds: [] }).success, false);
});

test("agent run schema requires output and completion time when completed", () => {
  assert.equal(agentRunSchema.safeParse(validAgentRun).success, true);

  assert.equal(
    agentRunSchema.safeParse({ ...validAgentRun, output: null }).success,
    false,
    "a completed run must carry output"
  );
  assert.equal(
    agentRunSchema.safeParse({ ...validAgentRun, completedAt: null }).success,
    false
  );

  const failed = agentRunSchema.safeParse({
    ...validAgentRun,
    status: "FAILED",
    output: null,
    error: "boom"
  });
  assert.equal(failed.success, true);

  assert.equal(
    agentRunSchema.safeParse({ ...validAgentRun, status: "FAILED", output: null, error: null }).success,
    false,
    "a failed run must record an error"
  );

  assert.equal(agentRunSchema.safeParse({ ...validAgentRun, agent: "marketing" }).success, false);
  assert.equal(agentRunSchema.safeParse({ ...validAgentRun, status: "DONE" }).success, false);
});

test("research job schema pins status, depth and modules to known values", () => {
  assert.equal(researchJobSchema.safeParse(validJob).success, true);

  assert.equal(researchJobSchema.safeParse({ ...validJob, status: "FINISHED" }).success, false);
  assert.equal(researchJobSchema.safeParse({ ...validJob, depth: "deep" }).success, false);
  assert.equal(researchJobSchema.safeParse({ ...validJob, requestedModules: ["chart-ish"] }).success, false);
  assert.equal(researchJobSchema.safeParse({ ...validJob, requestedModules: [] }).success, false);
  assert.equal(researchJobSchema.safeParse({ ...validJob, jobId: "job-1" }).success, false);
  assert.equal(researchJobSchema.safeParse({ ...validJob, newsLookbackDays: -1 }).success, false);
});

test("research report schema requires every coordinator section", () => {
  assert.equal(researchReportSchema.safeParse(validReport).success, true);

  const { technical, ...incomplete } = validReport.sections;
  const missingSection = researchReportSchema.safeParse({ ...validReport, sections: incomplete });
  assert.equal(missingSection.success, false);
  assert.match(missingSection.error.issues[0].message, /technical/);

  assert.equal(researchReportSchema.safeParse({ ...validReport, reportId: "r1" }).success, false);
  assert.equal(
    researchReportSchema.safeParse({ ...validReport, agentStatus: { technical: "SOMETHING" } }).success,
    false
  );
});

test("gate result schema keeps the verdict consistent with its findings", () => {
  assert.equal(gateResultSchema.safeParse(validGate).success, true);

  const blockedWithoutFinding = gateResultSchema.safeParse({
    ...validGate,
    verdict: "BLOCKED"
  });
  assert.equal(blockedWithoutFinding.success, false);

  assert.equal(
    gateResultSchema.safeParse({
      ...validGate,
      blocking: [{ rule: "x", message: "y" }]
    }).success,
    false,
    "PASS cannot carry blocking findings"
  );

  assert.equal(
    gateResultSchema.safeParse({
      ...validGate,
      verdict: "PASS_WITH_WARNINGS",
      warnings: []
    }).success,
    false,
    "PASS_WITH_WARNINGS needs at least one warning"
  );

  assert.equal(
    gateResultSchema.safeParse({
      ...validGate,
      warnings: [{ rule: "x", message: "y" }]
    }).success,
    false,
    "PASS cannot carry warnings"
  );

  assert.equal(
    gateResultSchema.safeParse({ ...validGate, checks: [] }).success,
    false,
    "a gate result must record what it checked"
  );
});

test("analysis report schema rejects partially formed AI output", () => {
  assert.equal(analysisReportSchema.safeParse(validAnalysis).success, true);

  const { dataIntegrity, ...missing } = validAnalysis;
  assert.equal(analysisReportSchema.safeParse(missing).success, false);
  assert.equal(analysisReportSchema.safeParse({ ...validAnalysis, risks: [] }).success, false);
  assert.equal(analysisReportSchema.safeParse({ ...validAnalysis, headline: "" }).success, false);
});
