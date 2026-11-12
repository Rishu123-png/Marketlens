import test from "node:test";
import assert from "node:assert/strict";
import { analyzeMarketStructure } from "../../server/patterns/structure.js";
import { aggregateFourHour } from "../../server/market-data/candles.js";

function candle(time, open, high, low, close, volume = 1000) {
  return { time, open, high, low, close, volume, source: "test" };
}

function syntheticSeries() {
  const candles = [];
  let price = 100;
  for (let index = 0; index < 60; index += 1) {
    const ramp = index < 30 ? 0.9 : -0.8;
    const open = price;
    const close = price + ramp + (index % 5 === 0 ? -0.4 : 0.3);
    const high = Math.max(open, close) + 0.6;
    const low = Math.min(open, close) - 0.6;
    candles.push(candle(`2026-01-${String(Math.floor(index / 4) + 1).padStart(2, "0")} ${String(9 + (index % 4)).padStart(2, "0")}:00:00`, open, high, low, close));
    price = close;
  }
  return candles;
}

test("structure analysis requires enough candles and says so", () => {
  const result = analyzeMarketStructure(syntheticSeries().slice(0, 10));
  assert.equal(result.signals.length, 0);
  assert.match(result.limitations[0], /at least 30/);
  assert.ok(result.rules.length >= 6);
});

test("structure signals are deterministic, rule-labelled and carry invalidation", () => {
  const series = syntheticSeries();
  const first = analyzeMarketStructure(series, { interval: "1day" });
  const second = analyzeMarketStructure(series, { interval: "1day" });
  assert.deepEqual(first.signals, second.signals);
  assert.ok(first.signals.length > 0, "the synthetic reversal should produce at least one structural signal");

  for (const signal of first.signals) {
    assert.ok(signal.type);
    assert.ok(signal.rule);
    assert.ok(signal.invalidation);
    assert.ok(["low", "medium", "high"].includes(signal.confidence));
  }

  assert.ok(first.signals.some((signal) => signal.type === "fair-value-gap" || signal.type === "BOS" || signal.type === "CHoCH"));
  assert.match(first.limitations.join(" "), /not a forecast|not knowledge/);
});

test("a fair-value gap is detected from a three-candle imbalance", () => {
  const candles = [];
  for (let index = 0; index < 30; index += 1) {
    candles.push(candle(`2026-02-${String(index + 1).padStart(2, "0")}`, 100, 101, 99, 100));
  }
  candles.push(candle("2026-03-01", 100, 101, 99.5, 100.5));
  candles.push(candle("2026-03-02", 105, 110, 104, 109));
  candles.push(candle("2026-03-03", 111, 112, 110, 111));

  const result = analyzeMarketStructure(candles);
  const gap = result.signals.find((signal) => signal.type === "fair-value-gap" && signal.direction === "bullish");
  assert.ok(gap, "expected a bullish FVG");
  assert.equal(gap.low, 101);
  assert.equal(gap.high, 104);
});

test("four-hour aggregation builds OHLCV buckets from hourly candles", () => {
  const hours = [
    ["2026-11-11 09:00:00", 100, 102, 99, 101, 10],
    ["2026-11-11 10:00:00", 101, 104, 100, 103, 20],
    ["2026-11-11 11:00:00", 103, 105, 102, 102, 30],
    ["2026-11-11 12:00:00", 102, 103, 98, 99, 40],
    ["2026-11-11 13:00:00", 99, 101, 97, 100, 50]
  ].map(([time, open, high, low, close, volume]) => candle(time, open, high, low, close, volume));

  const buckets = aggregateFourHour(hours);
  assert.equal(buckets.length, 2);
  assert.equal(buckets[0].open, 100);
  assert.equal(buckets[0].high, 105);
  assert.equal(buckets[0].low, 99);
  assert.equal(buckets[0].close, 102);
  assert.equal(buckets[0].volume, 60);
  assert.equal(buckets[1].open, 102);
  assert.equal(buckets[1].high, 103);
  assert.equal(buckets[1].low, 97);
  assert.equal(buckets[1].close, 100);
  assert.equal(buckets[1].volume, 90);
});
