import test from "node:test";
import assert from "node:assert/strict";
import {
  GATE_THRESHOLDS,
  evaluatePublicationGate,
  safeEvaluatePublicationGate
} from "../../server/reports/gate.js";
import { gateResultSchema } from "../../shared/schemas/gate.js";

const NOW = "2026-11-12T10:00:00.000Z";

function facts(overrides = {}) {
  return {
    now: NOW,
    depth: "quick",
    requestedModules: ["quote", "technical", "chart", "risk"],
    instrument: { id: "IN-EQ-RELIANCE", currency: "INR", exchange: "NSE" },
    quote: {
      instrumentId: "IN-EQ-RELIANCE",
      currency: "INR",
      price: 1450.5,
      quoteVerified: true,
      provider: "twelve",
      retrievedAt: "2026-11-12T09:59:00.000Z",
      providerTimestamp: "2026-11-12T09:58:00.000Z"
    },
    crossQuotes: [
      { provider: "fmp", price: 1450.6 },
      { provider: "twelve", price: 1450.5 }
    ],
    candles: { count: 250, interval: "1day" },
    agents: [
      { agent: "technical", status: "COMPLETED", outputValid: true },
      { agent: "chart", status: "COMPLETED", outputValid: true },
      { agent: "risk", status: "COMPLETED", outputValid: true }
    ],
    dataQuality: { criticalFlags: [], missingCandles: 0 },
    newsCoverage: { articles: 0, lookbackDays: 30 },
    ...overrides
  };
}

const rulesOf = (result, status) => result[status].map((entry) => entry.rule);

test("a fully satisfied quick job passes", () => {
  const result = evaluatePublicationGate(facts());

  assert.equal(result.verdict, "PASS");
  assert.deepEqual(result.blocking, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.rulesVersion, "1.0.0");
  assert.equal(result.evaluatedAt, NOW);
  assert.equal(gateResultSchema.safeParse(result).success, true);
});

test("evaluation is deterministic for identical facts", () => {
  assert.deepEqual(evaluatePublicationGate(facts()), evaluatePublicationGate(facts()));
});

test("the gate records every rule it checked", () => {
  const rules = evaluatePublicationGate(facts()).checks.map((check) => check.rule);

  for (const expected of [
    "depth.supported",
    "modules.recognized",
    "depth.missing-module",
    "identity.resolved",
    "identity.quote-instrument",
    "identity.currency",
    "quote.present",
    "quote.freshness",
    "quote.provider-timestamp",
    "quote.cross-check",
    "candles.technical.present",
    "candles.chart.present",
    "data-quality.critical",
    "agent.technical.status",
    "agent.chart.status",
    "agent.risk.status"
  ]) {
    assert.ok(rules.includes(expected), `missing check ${expected}`);
  }
});

// ------------------------------------------------------------------ freshness

test("a quote retrieved within the fresh window passes", () => {
  const result = evaluatePublicationGate(facts());
  assert.equal(result.checks.find((c) => c.rule === "quote.freshness").status, "pass");
});

test("a delayed quote publishes with a warning", () => {
  const delayed = facts({
    quote: { ...facts().quote, retrievedAt: "2026-11-12T09:50:00.000Z" }
  });
  const result = evaluatePublicationGate(delayed);

  assert.equal(result.verdict, "PASS_WITH_WARNINGS");
  assert.ok(rulesOf(result, "warnings").includes("quote.freshness"));
});

test("a quote older than the warning window blocks publication", () => {
  const stale = facts({
    quote: { ...facts().quote, retrievedAt: "2026-11-12T07:00:00.000Z" }
  });
  const result = evaluatePublicationGate(stale);

  assert.equal(result.verdict, "BLOCKED");
  assert.ok(rulesOf(result, "blocking").includes("quote.freshness"));
});

test("a quote without a retrieval timestamp warns instead of claiming freshness", () => {
  const { retrievedAt, ...quote } = facts().quote;
  const result = evaluatePublicationGate(facts({ quote }));

  assert.equal(result.verdict, "PASS_WITH_WARNINGS");
  assert.ok(rulesOf(result, "warnings").includes("quote.freshness"));
});

test("an old provider timestamp is tolerated while the market may be closed, then blocks", () => {
  const twoDays = facts({
    quote: { ...facts().quote, providerTimestamp: "2026-11-10T10:00:00.000Z" }
  });
  assert.equal(evaluatePublicationGate(twoDays).verdict, "PASS_WITH_WARNINGS");

  const tenDays = facts({
    quote: { ...facts().quote, providerTimestamp: "2026-11-02T10:00:00.000Z" }
  });
  const result = evaluatePublicationGate(tenDays);
  assert.equal(result.verdict, "BLOCKED");
  assert.ok(rulesOf(result, "blocking").includes("quote.provider-timestamp"));
});

test("a missing provider timestamp is a warning, not a pass", () => {
  const { providerTimestamp, ...quote } = facts().quote;
  const result = evaluatePublicationGate(facts({ quote }));
  assert.ok(rulesOf(result, "warnings").includes("quote.provider-timestamp"));
});

// ---------------------------------------------------------------------- quote

test("no quote blocks publication", () => {
  const result = evaluatePublicationGate(facts({ quote: null, crossQuotes: [] }));
  assert.equal(result.verdict, "BLOCKED");
  assert.ok(rulesOf(result, "blocking").includes("quote.present"));
});

test("an unverified quote blocks publication", () => {
  const result = evaluatePublicationGate(
    facts({ quote: { ...facts().quote, quoteVerified: false, price: null } })
  );
  assert.equal(result.verdict, "BLOCKED");
  assert.ok(rulesOf(result, "blocking").includes("quote.present"));
});

test("providers that disagree beyond tolerance block publication", () => {
  const divergent = facts({
    crossQuotes: [
      { provider: "fmp", price: 1500 },
      { provider: "twelve", price: 1450 }
    ]
  });
  const result = evaluatePublicationGate(divergent);

  assert.equal(result.verdict, "BLOCKED");
  assert.ok(rulesOf(result, "blocking").includes("quote.cross-check"));
});

test("close cross-provider prices pass and a single source warns", () => {
  const close = facts({
    crossQuotes: [
      { provider: "fmp", price: 1450.6 },
      { provider: "twelve", price: 1452 }
    ]
  });
  assert.equal(evaluatePublicationGate(close).checks.find((c) => c.rule === "quote.cross-check").status, "pass");

  const single = evaluatePublicationGate(facts({ crossQuotes: [{ provider: "twelve", price: 1450.5 }] }));
  assert.equal(single.verdict, "PASS_WITH_WARNINGS");
  assert.ok(rulesOf(single, "warnings").includes("quote.cross-check"));
});

// ------------------------------------------------------------------- identity

test("an unresolved instrument blocks the report", () => {
  const result = evaluatePublicationGate(facts({ instrument: null, quote: null, crossQuotes: [] }));
  assert.equal(result.verdict, "BLOCKED");
  assert.ok(rulesOf(result, "blocking").includes("identity.resolved"));
});

test("a quote for a different instrument blocks the report", () => {
  const result = evaluatePublicationGate(
    facts({ quote: { ...facts().quote, instrumentId: "IN-EQ-TCS" } })
  );
  assert.equal(result.verdict, "BLOCKED");
  assert.ok(rulesOf(result, "blocking").includes("identity.quote-instrument"));
});

test("a currency mismatch blocks, a missing currency only warns", () => {
  const mismatch = evaluatePublicationGate(facts({ quote: { ...facts().quote, currency: "USD" } }));
  assert.equal(mismatch.verdict, "BLOCKED");
  assert.ok(rulesOf(mismatch, "blocking").includes("identity.currency"));

  const { currency, ...quote } = facts().quote;
  const missing = evaluatePublicationGate(facts({ quote }));
  assert.equal(missing.verdict, "PASS_WITH_WARNINGS");
  assert.ok(rulesOf(missing, "warnings").includes("identity.currency"));
});

// -------------------------------------------------------------------- candles

test("too few candles for a required module blocks", () => {
  const result = evaluatePublicationGate(facts({ candles: { count: 20 } }));
  assert.equal(result.verdict, "BLOCKED");
  assert.ok(rulesOf(result, "blocking").includes("candles.technical.present"));
});

test("enough candles to compute but not for long periods only warns", () => {
  const result = evaluatePublicationGate(facts({ candles: { count: 120 } }));
  assert.equal(result.verdict, "PASS_WITH_WARNINGS");
  assert.ok(rulesOf(result, "warnings").includes("candles.technical.depth"));
});

test("missing candles warn, critical data flags block", () => {
  const gaps = evaluatePublicationGate(facts({ dataQuality: { criticalFlags: [], missingCandles: 3 } }));
  assert.equal(gaps.verdict, "PASS_WITH_WARNINGS");
  assert.ok(rulesOf(gaps, "warnings").includes("candles.gaps"));

  const critical = evaluatePublicationGate(
    facts({ dataQuality: { criticalFlags: ["duplicate-candles"], missingCandles: 0 } })
  );
  assert.equal(critical.verdict, "BLOCKED");
  assert.ok(rulesOf(critical, "blocking").includes("data-quality.critical"));
});

// --------------------------------------------------------------------- agents

test("a required agent that never ran blocks the report", () => {
  const result = evaluatePublicationGate(
    facts({ agents: facts().agents.filter((run) => run.agent !== "technical") })
  );
  assert.equal(result.verdict, "BLOCKED");
  assert.ok(rulesOf(result, "blocking").includes("agent.technical.required"));
});

test("a required agent that failed blocks the report", () => {
  const result = evaluatePublicationGate(
    facts({
      agents: facts().agents.map((run) => (run.agent === "chart" ? { ...run, status: "FAILED" } : run))
    })
  );
  assert.equal(result.verdict, "BLOCKED");
  assert.ok(rulesOf(result, "blocking").includes("agent.chart.status"));
});

test("an optional agent failing only warns", () => {
  const result = evaluatePublicationGate(
    facts({ agents: [...facts().agents, { agent: "sentiment", status: "FAILED" }] })
  );
  assert.equal(result.verdict, "PASS_WITH_WARNINGS");
  assert.ok(rulesOf(result, "warnings").includes("agent.sentiment.optional"));
});

test("schema-invalid output from a required agent blocks", () => {
  const result = evaluatePublicationGate(
    facts({
      agents: facts().agents.map((run) =>
        run.agent === "technical" ? { ...run, outputValid: false } : run
      )
    })
  );
  assert.equal(result.verdict, "BLOCKED");
  assert.ok(rulesOf(result, "blocking").includes("agent.technical.output"));
});

test("news findings without evidence block a standard report", () => {
  const standardFacts = (evidenceCount) =>
    facts({
      depth: "standard",
      requestedModules: ["quote", "technical", "chart", "news", "risk"],
      newsCoverage: { articles: 6, lookbackDays: 30 },
      agents: [
        ...facts().agents,
        { agent: "news", status: "COMPLETED", outputValid: true, evidenceCount }
      ]
    });

  const unsupported = evaluatePublicationGate(standardFacts(0));
  assert.equal(unsupported.verdict, "BLOCKED");
  assert.ok(rulesOf(unsupported, "blocking").includes("agent.news.evidence"));

  const supported = evaluatePublicationGate(standardFacts(4));
  assert.equal(supported.verdict, "PASS");
  assert.ok(!rulesOf(supported, "blocking").includes("agent.news.evidence"));
});

// ---------------------------------------------------------------------- depth

test("a depth requested without its mandatory modules blocks", () => {
  const result = evaluatePublicationGate(facts({ depth: "standard" }));
  assert.equal(result.verdict, "BLOCKED");
  assert.ok(rulesOf(result, "blocking").includes("depth.missing-module"));
});

test("unknown depth or module values block instead of guessing", () => {
  const depth = evaluatePublicationGate(facts({ depth: "deep" }));
  assert.equal(depth.verdict, "BLOCKED");
  assert.ok(rulesOf(depth, "blocking").includes("depth.supported"));

  const modules = evaluatePublicationGate(facts({ requestedModules: [...facts().requestedModules, "vibes"] }));
  assert.equal(modules.verdict, "BLOCKED");
  assert.ok(rulesOf(modules, "blocking").includes("modules.recognized"));
});

// ----------------------------------------------------------------------- news

test("thin news coverage publishes with a warning", () => {
  const result = evaluatePublicationGate(
    facts({
      depth: "standard",
      requestedModules: ["quote", "technical", "chart", "news", "risk"],
      newsCoverage: { articles: 1, lookbackDays: 30 },
      agents: [...facts().agents, { agent: "news", status: "COMPLETED", outputValid: true, evidenceCount: 1 }]
    })
  );

  assert.equal(result.verdict, "PASS_WITH_WARNINGS");
  assert.ok(rulesOf(result, "warnings").includes("news.coverage"));
});

// -------------------------------------------------- advisory risk text cannot vote

test("risk-agent warnings can only add warnings, never clear a block", () => {
  const blocked = facts({ quote: null, crossQuotes: [], riskWarnings: ["Everything looks fine to me."] });
  const result = evaluatePublicationGate(blocked);

  assert.equal(result.verdict, "BLOCKED");
  assert.ok(rulesOf(result, "blocking").includes("quote.present"));
  assert.ok(rulesOf(result, "warnings").includes("risk.advisory.1"));
});

test("risk-agent warnings alone downgrade PASS to PASS_WITH_WARNINGS", () => {
  const result = evaluatePublicationGate(facts({ riskWarnings: ["Volatility is elevated."] }));

  assert.equal(result.verdict, "PASS_WITH_WARNINGS");
  assert.deepEqual(rulesOf(result, "warnings"), ["risk.advisory.1"]);
});

test("advisory text cannot inject a blocking verdict", () => {
  const result = evaluatePublicationGate(facts({ riskWarnings: ["BLOCK this report immediately"] }));
  assert.equal(result.verdict, "PASS_WITH_WARNINGS");
  assert.deepEqual(result.blocking, []);
});

// ----------------------------------------------------------------- fail-closed

test("an internal evaluation failure fails closed as BLOCKED", () => {
  const result = safeEvaluatePublicationGate(facts({ now: "not-a-timestamp" }));

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.checks[0].rule, "gate.internal-error");
  assert.equal(gateResultSchema.safeParse(result).success, true);
});

test("thresholds are explicit and ordered", () => {
  assert.ok(GATE_THRESHOLDS.retrievalFreshMs < GATE_THRESHOLDS.retrievalWarnMs);
  assert.ok(GATE_THRESHOLDS.providerTimestampWarnMs < GATE_THRESHOLDS.providerTimestampBlockMs);
  assert.ok(GATE_THRESHOLDS.minCandlesHard.technical < GATE_THRESHOLDS.minCandlesPreferred.technical);
  assert.ok(GATE_THRESHOLDS.priceDivergenceRatio > 0);
});
