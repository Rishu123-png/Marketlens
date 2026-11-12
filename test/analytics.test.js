import test from "node:test";
import assert from "node:assert/strict";
import historyHandler from "../api/history.js";
import indicatorsHandler from "../api/indicators.js";
import analysisHandler from "../api/analysis.js";
import { clearCandleCache } from "../server/market-data/candles.js";
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

function series(count = 120) {
  const values = [];
  for (let index = count; index > 0; index -= 1) {
    const day = new Date(Date.UTC(2026, 0, 1) + index * 86_400_000).toISOString().slice(0, 10);
    const close = 100 + Math.sin(index / 6) * 6 + (count - index) * 0.2;
    values.push({
      datetime: day,
      open: (close - 0.4).toFixed(2),
      high: (close + 0.9).toFixed(2),
      low: (close - 0.9).toFixed(2),
      close: close.toFixed(2),
      volume: "150000"
    });
  }
  return values;
}

async function withTwelveData(callback) {
  const previous = {
    TWELVE_DATA_API_KEY: process.env.TWELVE_DATA_API_KEY,
    PRIMARY_MARKET_PROVIDER: process.env.PRIMARY_MARKET_PROVIDER
  };
  process.env.TWELVE_DATA_API_KEY = "test-twelve-key";
  process.env.PRIMARY_MARKET_PROVIDER = "twelve";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.twelvedata.com/time_series")) {
      return Response.json({ status: "ok", values: series() });
    }
    return Response.json({ status: "error", message: "unexpected upstream call" });
  };

  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearCandleCache();
    resetRateLimitsForTests();
  }
}

test("history endpoint returns validated candles with coverage", async () => {
  resetRateLimitsForTests();
  clearCandleCache();
  await withTwelveData(async () => {
    const res = mockResponse();
    await historyHandler({ query: { symbol: "RELIANCE", exchange: "NSE", interval: "1day", limit: "60" } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.mode, "historical");
    assert.equal(res.body.instrumentId, "IN-EQ-RELIANCE");
    assert.equal(res.body.candles.length, 60);
    assert.equal(res.body.coverage.count, 60);
    assert.equal(res.body.coverage.complete, true);
    assert.ok(res.body.retrievedAt);
    assert.ok(res.body.candles.every((candle) => candle.source === "Twelve Data"));
    assert.ok(res.body.candles.every((candle) => candle.high >= candle.low));
  });
});

test("history endpoint rejects bad symbols and intervals", async () => {
  resetRateLimitsForTests();
  const badSymbol = mockResponse();
  await historyHandler({ query: { symbol: "rel/iance;drop" } }, badSymbol);
  assert.equal(badSymbol.statusCode, 400);

  const badInterval = mockResponse();
  await historyHandler({ query: { symbol: "INFY", interval: "2h" } }, badInterval);
  assert.equal(badInterval.statusCode, 400);
  assert.ok(badInterval.body.supported.includes("1day"));
});

test("indicators endpoint exposes deterministic values plus engine version", async () => {
  resetRateLimitsForTests();
  clearCandleCache();
  await withTwelveData(async () => {
    const res = mockResponse();
    await indicatorsHandler({ query: { symbol: "INFY", exchange: "NSE" } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.calculation.version, "1.0.0");
    assert.equal(res.body.indicators.candles, 120);
    assert.ok(typeof res.body.indicators.rsi === "number");
    assert.ok(res.body.indicators.movingAverages.sma20 !== null);
    assert.equal(res.body.retrievedAt, res.body.retrievedAt);
  });
});

test("analysis endpoint returns candles, indicators and chart patterns, without AI", async () => {
  resetRateLimitsForTests();
  clearCandleCache();
  await withTwelveData(async () => {
    const res = mockResponse();
    await analysisHandler({ query: { symbol: "INFY", exchange: "NSE", interval: "1day" } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.mode, "deterministic-analysis");
    assert.equal(res.body.versions.patterns, "1.0.0");
    assert.ok(res.body.chart.trend.label);
    assert.ok(Array.isArray(res.body.chart.supportResistance));
    assert.ok(Array.isArray(res.body.candles));
    assert.equal(res.body.indicators.candles, res.body.candles.length);
    assert.ok(!("analysis" in res.body), "AI interpretation must not be embedded in deterministic analysis");
  });
});

test("analysis endpoint degrades to 503 when no provider is configured", async () => {
  resetRateLimitsForTests();
  clearCandleCache();
  const previousKey = process.env.TWELVE_DATA_API_KEY;
  const previousPrimary = process.env.PRIMARY_MARKET_PROVIDER;
  delete process.env.TWELVE_DATA_API_KEY;
  delete process.env.FMP_API_KEY;
  delete process.env.ALPHA_VANTAGE_API_KEY;
  process.env.PRIMARY_MARKET_PROVIDER = "twelve";

  try {
    const res = mockResponse();
    await analysisHandler({ query: { symbol: "INFY", exchange: "NSE" } }, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /No configured provider/i);
  } finally {
    if (previousKey !== undefined) process.env.TWELVE_DATA_API_KEY = previousKey;
    if (previousPrimary !== undefined) process.env.PRIMARY_MARKET_PROVIDER = previousPrimary;
    clearCandleCache();
  }
});
