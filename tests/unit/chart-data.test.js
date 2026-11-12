import test from "node:test";
import assert from "node:assert/strict";
import { chartPaths, chartRequestKey, fetchChartData } from "../../src/lib/chartData.js";

test("chart paths request history, analysis and the verified quote", () => {
  const paths = chartPaths({ symbol: "TCS", exchange: "NSE", interval: "4h", limit: 320 });
  assert.match(paths.history, /^\/api\/history\?symbol=TCS&exchange=NSE&interval=4h&limit=320$/);
  assert.match(paths.analysis, /^\/api\/analysis\?symbol=TCS&exchange=NSE&interval=4h&limit=320$/);
  assert.equal(paths.quote, "/api/market?symbol=TCS&exchange=NSE");
  assert.equal(chartRequestKey({ symbol: "TCS", exchange: "NSE", interval: "4h" }), "TCS|NSE|4h");
});

test("history is requested before analysis and analysis candles are replaced by history candles", async () => {
  const calls = [];
  const historyCandles = [{ time: "2026-11-12", open: 1, high: 2, low: 1, close: 2, volume: 10 }];
  const apiImpl = async (path) => {
    calls.push(path);
    if (path.startsWith("/api/history")) {
      return { candles: historyCandles, coverage: { count: 1 }, source: "History Source", retrievedAt: "2026-11-12T10:00:00.000Z", cached: true };
    }
    if (path.startsWith("/api/market")) return { symbol: "TCS", price: 4120.5, currency: "INR" };
    return { candles: [{ time: "2026-11-11" }], indicators: { rsi: 55 }, series: { rsi14: [] }, chart: { trend: {} } };
  };

  const result = await fetchChartData({ symbol: "TCS", exchange: "NSE", interval: "1day", apiImpl });
  assert.equal(result.error, null);
  assert.equal(calls.length, 3);
  assert.match(calls[0], /^\/api\/history/);
  assert.match(calls[1], /^\/api\/market/);
  assert.match(calls[2], /^\/api\/analysis/);
  assert.deepEqual(result.analysis.candles, historyCandles);
  assert.equal(result.analysis.indicators.rsi, 55);
  assert.equal(result.analysis.source, "History Source");
  assert.equal(result.analysis.cached, true);
  assert.equal(result.quote.price, 4120.5);
});

test("history failure still returns analysis data and reports the quote error separately", async () => {
  const apiImpl = async (path) => {
    if (path.startsWith("/api/history")) {
      const error = new Error("No configured provider could return historical candles for this instrument.");
      error.status = 503;
      throw error;
    }
    if (path.startsWith("/api/market")) throw new Error("No verified quote.");
    return { candles: [{ time: "2026-11-12" }], indicators: { rsi: 50 }, series: {}, chart: {} };
  };

  const result = await fetchChartData({ symbol: "INFY", exchange: "NSE", interval: "1day", apiImpl });
  assert.ok(result.analysis, "analysis data is still usable");
  assert.match(result.quoteError, /No verified quote/);
  assert.equal(result.error, null);
});

test("total failure returns a structured error and never fabricates candles", async () => {
  const apiImpl = async (path) => {
    if (path.startsWith("/api/market")) return { price: 1 };
    const error = new Error("Candles unavailable.");
    error.status = 503;
    error.details = [{ provider: "fmp", message: "not configured" }];
    throw error;
  };

  const result = await fetchChartData({ symbol: "TCS", exchange: "NSE", interval: "1day", apiImpl });
  assert.equal(result.analysis, null);
  assert.equal(result.error.status, 503);
  assert.match(result.error.message, /Candles unavailable/);
  assert.equal(result.error.details[0].provider, "fmp");
});

test("indicator failure leaves history candles usable and warns instead of inventing series", async () => {
  const apiImpl = async (path) => {
    if (path.startsWith("/api/history")) {
      return { candles: [{ time: "2026-11-12", close: 100 }], coverage: { count: 1 }, source: "FMP" };
    }
    if (path.startsWith("/api/market")) throw new Error("no quote");
    throw new Error("analysis failed");
  };

  const result = await fetchChartData({ symbol: "TCS", exchange: "NSE", interval: "1day", apiImpl });
  assert.equal(result.analysis.series, null);
  assert.equal(result.analysis.indicators, null);
  assert.match(result.analysisWarning, /indicator series/);
});
