import test from "node:test";
import assert from "node:assert/strict";
import {
  atr,
  bollingerBands,
  ema,
  indicatorSnapshot,
  latest,
  macd,
  relativeVolume,
  rsi,
  sma
} from "../../server/indicators/index.js";

const closeTo = (actual, expected, tolerance = 1e-6) => {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
};

test("sma aligns to the input and pads the warm-up window with null", () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test("sma refuses to bridge a missing value", () => {
  assert.deepEqual(sma([1, 2, null, 4, 5, 6], 2), [null, 1.5, null, null, 4.5, 5.5]);
});

test("sma returns all nulls when there is not enough history", () => {
  assert.deepEqual(sma([1, 2], 5), [null, null]);
});

test("ema seeds from the simple average and then applies k = 2 / (n + 1)", () => {
  const values = [10, 20, 40];
  const result = ema(values, 2);
  assert.equal(result[0], null);
  closeTo(result[1], 15);
  // 40 * (2/3) + 15 * (1/3)
  closeTo(result[2], 31.666666666666668);
});

test("ema of a constant series equals that constant", () => {
  const result = ema([7, 7, 7, 7, 7], 3);
  assert.equal(result[0], null);
  assert.equal(result[1], null);
  closeTo(result[2], 7);
  closeTo(result[4], 7);
});

test("rsi matches a hand-computed Wilder example", () => {
  // closes: 10, 11, 12, 11, 12, 13 with period 3
  const result = rsi([10, 11, 12, 11, 12, 13], 3);
  assert.equal(result[0], null);
  assert.equal(result[2], null);
  closeTo(result[3], 66.66666666666667);
  closeTo(result[4], 77.77777777777777);
  closeTo(result[5], 85.18518518518519);
});

test("rsi saturates for monotonic and flat series", () => {
  const rising = rsi([1, 2, 3, 4, 5, 6, 7], 3);
  closeTo(rising.at(-1), 100);

  const falling = rsi([7, 6, 5, 4, 3, 2, 1], 3);
  closeTo(falling.at(-1), 0);

  const flat = rsi([5, 5, 5, 5, 5, 5], 3);
  closeTo(flat.at(-1), 50);
});

test("rsi stays bounded and null when history is insufficient", () => {
  assert.deepEqual(rsi([1, 2, 3], 14), [null, null, null]);

  const series = [44, 44.3, 44.1, 43.6, 44.8, 45.2, 44.9, 45.6, 46.1, 45.4, 46.8];
  for (const value of rsi(series, 3)) {
    if (value !== null) assert.ok(value >= 0 && value <= 100);
  }
});

test("macd of a constant series is flat at zero", () => {
  const { macdLine, signalLine, histogram } = macd(Array(40).fill(100));
  for (const series of [macdLine, signalLine, histogram]) {
    for (const value of series) {
      if (value !== null) closeTo(value, 0);
    }
  }
});

test("macd holds the theoretical EMA offset on a constant-slope trend", () => {
  // On a straight line both EMAs lag by (period - 1) / 2, so the MACD line
  // settles at (26 - 1) / 2 - (12 - 1) / 2 = 7 and momentum is flat.
  const closes = Array.from({ length: 60 }, (_, index) => 100 + index);
  const { macdLine, signalLine, histogram } = macd(closes);
  closeTo(macdLine.at(-1), 7, 1e-9);
  closeTo(signalLine.at(-1), 7, 1e-9);
  closeTo(histogram.at(-1), 0, 1e-9);
});

test("macd histogram turns positive when an uptrend accelerates", () => {
  const closes = [
    ...Array.from({ length: 60 }, (_, index) => 100 + index),
    165,
    172,
    181,
    192
  ];
  const { macdLine, histogram } = macd(closes);
  assert.ok(macdLine.at(-1) > 7);
  assert.ok(histogram.at(-1) > 0);
});

test("macd requires enough history for the slow and signal windows", () => {
  const { macdLine } = macd(Array.from({ length: 10 }, (_, index) => 100 + index));
  assert.equal(macdLine.at(-1), null);
});

test("atr of constant-range candles equals that range", () => {
  const candles = Array.from({ length: 10 }, () => ({ open: 10, high: 11, low: 9, close: 10 }));
  const result = atr(candles, 3);
  closeTo(result[2], 2);
  closeTo(result.at(-1), 2);
});

test("atr widens when a candle gaps away from the previous close", () => {
  const candles = [
    { high: 11, low: 9, close: 10 },
    { high: 11, low: 9, close: 10 },
    { high: 21, low: 19, close: 20 }
  ];
  // third true range = max(21-19, |21-10|, |19-10|) = 11
  const result = atr(candles, 3);
  closeTo(result[2], (2 + 2 + 11) / 3);
});

test("atr resets across a malformed candle instead of guessing", () => {
  const candles = [
    { high: 11, low: 9, close: 10 },
    { high: 11, low: 9, close: 10 },
    { high: null, low: 9, close: 10 },
    { high: 11, low: 9, close: 10 }
  ];
  const result = atr(candles, 2);
  closeTo(result[1], 2);
  assert.equal(result[2], null);
  assert.equal(result[3], null);
});

test("bollinger bands use the population standard deviation", () => {
  const { middle, upper, lower } = bollingerBands([1, 2, 3], 3, 2);
  closeTo(middle[2], 2);
  closeTo(upper[2], 2 + 2 * Math.sqrt(2 / 3));
  closeTo(lower[2], 2 - 2 * Math.sqrt(2 / 3));
});

test("bollinger bands collapse to a line for a flat series", () => {
  const { middle, upper, lower } = bollingerBands([5, 5, 5, 5], 3, 2);
  closeTo(middle.at(-1), 5);
  closeTo(upper.at(-1), 5);
  closeTo(lower.at(-1), 5);
});

test("bollinger bands are null during warm-up", () => {
  const { middle, upper, lower } = bollingerBands([1, 2], 3, 2);
  assert.deepEqual(middle, [null, null]);
  assert.deepEqual(upper, [null, null]);
  assert.deepEqual(lower, [null, null]);
});

test("relative volume compares the latest session with the prior baseline", () => {
  const result = relativeVolume([100, 100, 100, 100, 300], 4);
  assert.equal(result.latest, 300);
  closeTo(result.baseline, 100);
  closeTo(result.ratio, 3);
});

test("relative volume is null without a baseline or with a zero baseline", () => {
  assert.equal(relativeVolume([100, 200], 4).ratio, null);
  assert.equal(relativeVolume([0, 0, 0, 50], 3).ratio, null);
  assert.equal(relativeVolume([100, null, 100, 300], 3).ratio, null);
});

test("invalid periods and inputs are rejected loudly", () => {
  assert.throws(() => sma([1, 2, 3], 0), RangeError);
  assert.throws(() => ema([1, 2, 3], 1.5), RangeError);
  assert.throws(() => rsi("nope", 14), TypeError);
  assert.throws(() => atr([], 0), RangeError);
  assert.throws(() => atr("nope", 3), TypeError);
  assert.throws(() => macd([1, 2, 3], { fast: 26, slow: 12 }), RangeError);
  assert.throws(() => bollingerBands([1, 2, 3], 3, 0), RangeError);
});

test("latest returns the most recent non-null value", () => {
  assert.equal(latest([1, 2, null]), 2);
  assert.equal(latest([null, null]), null);
  assert.equal(latest(undefined), null);
});

test("indicator snapshot reports nulls instead of inventing readings", () => {
  const shortCandles = Array.from({ length: 5 }, (_, index) => ({
    high: 101 + index,
    low: 99 + index,
    close: 100 + index,
    volume: 1000
  }));

  const snapshot = indicatorSnapshot(shortCandles);
  assert.equal(snapshot.candles, 5);
  assert.equal(snapshot.lastClose, 104);
  assert.equal(snapshot.movingAverages.sma20, null);
  assert.equal(snapshot.movingAverages.sma200, null);
  assert.equal(snapshot.rsi, null);
  assert.equal(snapshot.atr, null);
  assert.equal(snapshot.bollinger.middle, null);
  assert.equal(snapshot.relativeVolume, null);
});

test("indicator snapshot exposes readings once history is sufficient", () => {
  const candles = Array.from({ length: 60 }, (_, index) => ({
    high: 102 + index,
    low: 98 + index,
    close: 100 + index,
    volume: 1000 + index
  }));

  const snapshot = indicatorSnapshot(candles);
  assert.equal(snapshot.candles, 60);
  assert.ok(Number.isFinite(snapshot.movingAverages.sma20));
  assert.ok(Number.isFinite(snapshot.movingAverages.ema9));
  assert.ok(Number.isFinite(snapshot.rsi));
  assert.ok(Number.isFinite(snapshot.atr));
  assert.ok(Number.isFinite(snapshot.bollinger.upper));
  assert.ok(Number.isFinite(snapshot.relativeVolume));
  assert.equal(snapshot.movingAverages.sma100, null);
  assert.equal(snapshot.movingAverages.sma200, null);
});
