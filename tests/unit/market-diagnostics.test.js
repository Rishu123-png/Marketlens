import test from "node:test";
import assert from "node:assert/strict";

import { clearCandleCache, getCandles } from "../../server/market-data/candles.js";
import { clearQuoteCache, getVerifiedQuote } from "../../server/market-data/gateway.js";
import {
  marketRequestSnapshot,
  resetObservationsForTests
} from "../../server/market-data/observations.js";
import { buildMarketDiagnostics } from "../../server/market-data/diagnostics.js";
import diagnosticsHandler from "../../handlers/diagnostics.js";
import { resetRateLimitsForTests } from "../../lib/server/rateLimit.js";
import { AGENT_IDS } from "../../shared/schemas/agent.js";

const rows = [
  { time: "2026-11-10", open: 100, high: 105, low: 99, close: 104, volume: 1000 },
  { time: "2026-11-11", open: 104, high: 108, low: 103, close: 107, volume: 1200 },
  { time: "2026-11-12", open: 107, high: 110, low: 106, close: 109, volume: 900 }
];

function fakeCandleProvider({ id = "stub", configured = true, data = rows, error = null } = {}) {
  return {
    id,
    label: id,
    isConfigured: () => configured,
    async fetchCandles() {
      if (error) throw error;
      return data.map((row) => ({ ...row, source: id }));
    }
  };
}

test("candle requests record provider selection, counts, cache and freshness", async () => {
  resetObservationsForTests();
  clearCandleCache();

  const providers = [
    fakeCandleProvider({ id: "unconfigured", configured: false }),
    fakeCandleProvider({ id: "working" })
  ];

  const first = await getCandles("TCS", {
    exchange: "NSE",
    interval: "1day",
    limit: 20,
    cache: false,
    providers
  });

  assert.equal(first.provider, "working");
  assert.equal(first.candles.length, 3);

  let events = marketRequestSnapshot({ kind: "candles" }).entries;
  assert.equal(events.length, 2);

  const skipped = events.find((entry) => entry.provider === "unconfigured");
  assert.equal(skipped.attempted, false);
  assert.equal(skipped.symbol, "TCS");
  assert.equal(skipped.exchange, "NSE");
  assert.equal(skipped.interval, "1day");
  assert.equal(skipped.requestedLimit, 20);
  assert.match(skipped.error, /not configured/);

  const success = events.find((entry) => entry.provider === "working");
  assert.equal(success.attempted, true);
  assert.equal(success.httpStatus, 200);
  assert.equal(success.returnedCount, 3);
  assert.equal(success.droppedCount, 0);
  assert.equal(success.cacheHit, false);
  assert.equal(success.dataTimestamp, "2026-11-12");
  assert.ok(Number.isFinite(success.durationMs));
  assert.ok(["fresh", "delayed", "eod-or-historical", "unknown"].includes(success.freshness));

  // Second call uses the cache and records a cache hit, not a provider retry.
  const cached = await getCandles("TCS", { exchange: "NSE", interval: "1day", limit: 20, providers });
  assert.equal(cached.cached, true);
  events = marketRequestSnapshot({ kind: "candles" }).entries;
  const hit = events[0];
  assert.equal(hit.cacheHit, true);
  assert.equal(hit.attempted, false);
  assert.equal(hit.returnedCount, 3);
});

test("invalid candle rows are counted as dropped, never repaired", async () => {
  resetObservationsForTests();
  clearCandleCache();

  const providers = [
    fakeCandleProvider({
      id: "partial",
      data: [...rows, { time: "2026-11-13", open: 1, high: 2, low: 3, close: null, volume: 1 }]
    })
  ];

  const data = await getCandles("INFY", { exchange: "NSE", interval: "1day", limit: 20, cache: false, providers });
  assert.equal(data.droppedRows, 1);
  assert.equal(data.coverage.complete, false);

  const event = marketRequestSnapshot({ kind: "candles" }).entries[0];
  assert.equal(event.droppedCount, 1);
  assert.equal(event.returnedCount, 3);
});

test("provider HTTP failures are recorded with status and a safe message", async () => {
  resetObservationsForTests();
  clearCandleCache();

  const error = new Error("Provider HTTP 429");
  error.status = 429;
  const providers = [fakeCandleProvider({ id: "limited", error })];

  await assert.rejects(() =>
    getCandles("HINDUNILVR", { exchange: "NSE", interval: "1day", cache: false, providers })
  );

  const event = marketRequestSnapshot({ kind: "candles" }).entries[0];
  assert.equal(event.provider, "limited");
  assert.equal(event.attempted, true);
  assert.equal(event.httpStatus, 429);
  assert.match(event.error, /429/);
  assert.equal(JSON.stringify(event).includes("apikey"), false);
});

test("quote requests are recorded separately from candle requests", async () => {
  resetObservationsForTests();
  clearQuoteCache();

  const quote = {
    quoteVerified: true,
    mode: "verified",
    instrumentId: "IN-EQ-TCS",
    symbol: "TCS",
    displaySymbol: "TCS",
    name: "Tata Consultancy Services Ltd",
    exchange: "NSE",
    country: "IN",
    currency: "INR",
    assetType: "equity",
    price: 4120.5,
    providerSymbol: "TCS",
    providerExchange: "NSE",
    providerCurrency: "INR",
    source: "Stub",
    provider: "stub",
    updatedAt: new Date().toISOString(),
    retrievedAt: new Date().toISOString(),
    providerTimestamp: new Date().toISOString(),
    freshness: "verified"
  };

  const provider = {
    id: "stub",
    label: "Stub",
    isConfigured: () => true,
    supports: () => true,
    fetchQuote: async () => quote
  };

  const verified = await getVerifiedQuote("TCS", { exchange: "NSE", cache: false, providers: [provider] });
  assert.equal(verified.price, 4120.5);

  const event = marketRequestSnapshot({ kind: "quote" }).entries[0];
  assert.equal(event.kind, "quote");
  assert.equal(event.symbol, "TCS");
  assert.equal(event.provider, "stub");
  assert.equal(event.httpStatus, 200);
  assert.equal(event.returnedCount, 1);
  assert.equal(event.cacheHit, false);
});

test("market diagnostics separate providers, coverage and live verification states", async () => {
  resetRateLimitsForTests();
  resetObservationsForTests();

  const diagnostics = buildMarketDiagnostics({
    env: { FMP_API_KEY: "fake-key-not-a-secret-to-send", TWELVE_DATA_API_KEY: "" },
    now: () => new Date("2026-11-12T10:00:00.000Z")
  });

  assert.equal(diagnostics.providers.fmp.configured, true);
  assert.equal(diagnostics.providers.fmp.verification, "configured-unverified");
  assert.equal(diagnostics.providers.fmp.liveVerified, false);
  assert.equal(diagnostics.providers.twelve.configured, false);
  assert.equal(diagnostics.instrumentCoverage.catalogued >= 160, true);
  assert.equal(diagnostics.instrumentCoverage.realtime, 0);
  assert.equal(diagnostics.freshness.classification, "delayed");

  assert.equal(diagnostics.mappingChecks.TCS.providers.fmp.ticker, "TCS.NS");
  assert.equal(diagnostics.mappingChecks.TCS.providers.twelve.ticker, "NSE:TCS");
  assert.equal(diagnostics.mappingChecks.TCS.providers.alpha.ticker, "TCS.NSE");
  assert.equal(diagnostics.mappingChecks.HINDUNILVR.providers.fmp.ticker, "HINDUNILVR.NS");
  assert.equal(diagnostics.mappingChecks.HINDUNILVR.providers.twelve.ticker, "NSE:HINDUNILVR");
  assert.equal(diagnostics.mappingChecks.TCS.providers.fmp.ticker === "TCS", false);

  assert.equal(JSON.stringify(diagnostics).includes("fake-key-not-a-secret-to-send"), false);
  assert.equal(JSON.stringify(diagnostics).includes("apikey="), false);
});

test("the diagnostics endpoint returns two independent panels without credentials", async () => {
  resetRateLimitsForTests();
  const previous = process.env.GROQ_API_KEY_CHART;
  process.env.GROQ_API_KEY_CHART = "endpoint-secret-do-not-print";
  try {
    const res = {
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

    await diagnosticsHandler({ query: {}, headers: {} }, res);

    assert.equal(res.statusCode, 200);
    assert.match(res.body.separation, /independent/i);
    assert.ok(res.body.ai);
    assert.ok(res.body.market);
    assert.equal(res.body.ai.credentials.agents.chart.envName, "GROQ_API_KEY_CHART");
    assert.equal(res.body.ai.credentials.agents.chart.configured, true);
    assert.deepEqual(Object.keys(res.body.ai.agents).sort(), [...AGENT_IDS].sort());
    assert.equal(res.body.market.instrumentCoverage.realtime, 0);
    assert.equal(JSON.stringify(res.body).includes("endpoint-secret-do-not-print"), false);
    assert.equal(JSON.stringify(res.body).includes("apikey="), false);
  } finally {
    if (previous === undefined) delete process.env.GROQ_API_KEY_CHART;
    else process.env.GROQ_API_KEY_CHART = previous;
  }
});

test("a provider that cannot serve an interval is skipped without a request", async () => {
  resetObservationsForTests();
  clearCandleCache();

  const providers = [
    {
      id: "daily-only",
      label: "Daily only",
      isConfigured: () => true,
      supportsCandleInterval: () => false,
      fetchCandles: async () => {
        throw new Error("must not be called");
      }
    },
    fakeCandleProvider({ id: "intraday", data: rows })
  ];

  const data = await getCandles("TCS", { exchange: "NSE", interval: "5min", limit: 20, cache: false, providers });
  assert.equal(data.provider, "intraday");

  const [attempted, skipped] = marketRequestSnapshot({ kind: "candles" }).entries;
  assert.equal(skipped.provider, "daily-only");
  assert.equal(skipped.attempted, false);
  assert.match(skipped.error, /does not support this interval/);
  assert.equal(attempted.attempted, true);
});
