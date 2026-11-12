import test from "node:test";
import assert from "node:assert/strict";
import {
  PATTERN_ENGINE_VERSION,
  analyzeChart,
  detectCandlestickPatterns,
  detectSupportResistance,
  detectTrend,
  findPivots
} from "../../server/patterns/index.js";

function series(closes, { spread = 1 } = {}) {
  return closes.map((close, index) => ({
    time: `2026-03-${String((index % 28) + 1).padStart(2, "0")}`,
    open: close - spread / 2,
    high: close + spread / 2,
    low: close - spread / 2,
    close,
    volume: 1000
  }));
}

function ramp(start, step, count) {
  return series(Array.from({ length: count }, (_, index) => start + index * step));
}

test("engine version is exposed and analysis is deterministic", () => {
  const candles = ramp(100, 0.5, 60);
  const first = analyzeChart(candles);
  const second = analyzeChart(candles);

  assert.equal(PATTERN_ENGINE_VERSION, "1.0.0");
  assert.equal(first.engineVersion, PATTERN_ENGINE_VERSION);
  assert.deepEqual(first, second);
});

test("insufficient history is reported instead of guessed", () => {
  const result = analyzeChart(ramp(100, 1, 5));
  assert.equal(result.trend.label, "insufficient-history");
  assert.equal(result.chartPatterns.length, 0);
  assert.match(result.trend.detail, /need 20 candles/);
  assert.equal(result.limitations.length, 1);
});

test("invalid candles are filtered, not repaired", () => {
  const candles = ramp(100, 0.3, 30);
  candles.splice(10, 0, { time: "2026-03-31", open: 1, high: 0.5, low: 2, close: 1 });
  const result = analyzeChart(candles);
  assert.equal(result.candles, 30);
});

test("trend direction follows the dominant slope", () => {
  const up = analyzeChart(ramp(100, 0.8, 60));
  const down = analyzeChart(ramp(160, -0.8, 60));
  assert.equal(up.trend.label, "uptrend");
  assert.equal(down.trend.label, "downtrend");
  assert.ok(["pivot-structure", "net-change-fallback"].includes(up.trend.method));
  assert.ok(up.trend.detail.length > 0);
});

test("flat series is labelled sideways trend but still reports a level", () => {
  const flat = analyzeChart(series(Array.from({ length: 50 }, () => 100)));
  assert.equal(flat.trend.label, "sideways");
});

test("pivots bracket local extremes", () => {
  const candles = series([100, 101, 102, 105, 102, 101, 100, 99, 100, 101]);
  const pivots = findPivots(candles, { left: 2, right: 2 });
  assert.equal(pivots.highs[0].price, candles[3].high);
  assert.equal(pivots.lows[0].price, candles[7].low);
});

test("repeated touches become support and resistance zones", () => {
  const closes = [];
  for (let cycle = 0; cycle < 3; cycle += 1) {
    closes.push(120, 118, 115, 112, 110, 112, 115, 118);
  }
  closes.push(115);

  const candles = series(closes);
  const pivots = findPivots(candles);
  const zones = detectSupportResistance(candles, pivots);

  assert.ok(zones.length > 0, "expected at least one zone");
  const resistance = zones.find((zone) => zone.kind === "resistance");
  const support = zones.find((zone) => zone.kind === "support");
  assert.ok(resistance, "expected a resistance zone near 120");
  assert.ok(support, "expected a support zone near 110");
  assert.ok(resistance.low >= 115);
  assert.ok(support.high <= 116);
  assert.ok(resistance.touches >= 2);
  assert.ok(Array.isArray(resistance.evidence));
});

test("candlestick patterns are read from the latest candles only", () => {
  const doji = {
    time: "2026-03-31",
    open: 100,
    high: 104,
    low: 96,
    close: 100.1,
    volume: 1000
  };
  const patterns = detectCandlestickPatterns([...series(Array.from({ length: 10 }, () => 100)), doji]);
  assert.ok(patterns.some((pattern) => pattern.name === "doji"));
  assert.equal(patterns.at(-1).index, 10);

  const engulfing = [
    ...series(Array.from({ length: 10 }, () => 100)),
    { time: "2026-03-30", open: 102, high: 102.5, low: 99.5, close: 100, volume: 1000 },
    { time: "2026-03-31", open: 99.5, high: 104, low: 99, close: 103.5, volume: 2000 }
  ];
  const engulfingPatterns = detectCandlestickPatterns(engulfing);
  assert.ok(engulfingPatterns.some((pattern) => pattern.name === "bullish-engulfing"));
});

test("detectTrend returns no trend for short series", () => {
  const trend = detectTrend(ramp(100, 1, 5), findPivots(ramp(100, 1, 5)));
  assert.equal(trend.label, "insufficient-history");
});

test("double top is detected from two comparable peaks", () => {
  const closes = [];
  for (let index = 0; index <= 10; index += 1) closes.push(100 + index * 2); // peak 120
  for (let index = 0; index < 8; index += 1) closes.push(118 - index * 2); // trough 104
  for (let index = 0; index < 8; index += 1) closes.push(106 + index * 2); // peak 120
  for (let index = 0; index < 14; index += 1) closes.push(118 - index * 2); // break below neckline

  const result = analyzeChart(series(closes));
  const pattern = result.chartPatterns.find((entry) => entry.name === "double-top");
  assert.ok(pattern, "expected a double top");
  assert.equal(pattern.status, "completed");
  assert.equal(pattern.kind, "reversal");
  assert.ok(pattern.neckline < 120);
  assert.ok(pattern.evidence.length >= 2);
});

