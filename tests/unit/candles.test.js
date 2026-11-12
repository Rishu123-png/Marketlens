import test from "node:test";
import assert from "node:assert/strict";
import { clearCandleCache, getCandles } from "../../server/market-data/candles.js";

function candle(time, close) {
  return { time, open: close - 1, high: close + 1, low: close - 2, close, volume: 1000 };
}

function provider(id, rows, { configured = true } = {}) {
  return {
    id,
    label: `${id} test provider`,
    isConfigured: () => configured,
    fetchCandles: async () => rows
  };
}

const rows = [
  candle("2026-01-03", 103),
  candle("2026-01-01", 101),
  candle("2026-01-02", 102)
];

test("candles are sorted, validated and cached", async () => {
  clearCandleCache();
  let calls = 0;
  const fake = {
    ...provider("fake", rows),
    fetchCandles: async () => {
      calls += 1;
      return rows;
    }
  };

  const first = await getCandles("RELIANCE", { exchange: "NSE", providers: [fake] });
  assert.equal(calls, 1);
  assert.equal(first.candles.length, 3);
  assert.deepEqual(first.candles.map((entry) => entry.time), ["2026-01-01", "2026-01-02", "2026-01-03"]);
  assert.equal(first.droppedRows, 0);
  assert.equal(first.coverage.complete, true);
  assert.equal(first.cached, false);

  const second = await getCandles("RELIANCE", { exchange: "NSE", providers: [fake] });
  assert.equal(calls, 1, "second read should come from cache");
  assert.equal(second.cached, true);

  clearCandleCache();
});

test("invalid rows are dropped and counted, never repaired", async () => {
  clearCandleCache();
  const fake = provider("partial", [
    ...rows,
    { time: "2026-01-04", open: 1, high: 2, low: 0.5, close: null, volume: 10 },
    { time: "2026-01-05", open: 5, high: 1, low: 9, close: 5, volume: 10 }
  ]);

  const result = await getCandles("INFY", { exchange: "NSE", providers: [fake] });
  assert.equal(result.candles.length, 3);
  assert.equal(result.droppedRows, 2);
  assert.equal(result.coverage.complete, false);
  clearCandleCache();
});

test("limit trims the tail of the series and is never below the analysis floor", async () => {
  clearCandleCache();
  const long = Array.from({ length: 12 }, (_, index) =>
    candle(`2026-02-${String(index + 1).padStart(2, "0")}`, 100 + index)
  );

  const trimmed = await getCandles("INFY", { exchange: "NSE", providers: [provider("fake", long)], limit: 10 });
  assert.equal(trimmed.candles.length, 10);
  assert.equal(trimmed.candles.at(-1).time, "2026-02-12");

  clearCandleCache();
  const tiny = await getCandles("INFY", { exchange: "NSE", providers: [provider("fake", long)], limit: 2 });
  assert.equal(tiny.candles.length, 10, "requests below the floor are raised to 10 candles");

  clearCandleCache();
});

test("unconfigured and failing providers fall through, then 503 with details", async () => {
  clearCandleCache();
  const missing = provider("missing", rows, { configured: false });
  const broken = {
    id: "broken",
    label: "broken provider",
    isConfigured: () => true,
    fetchCandles: async () => {
      throw new Error("upstream exploded");
    }
  };

  await assert.rejects(
    () => getCandles("INFY", { exchange: "NSE", providers: [missing, broken] }),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.details.length, 2);
      assert.match(error.details[1].message, /upstream exploded/);
      return true;
    }
  );
  clearCandleCache();
});

test("invalid interval and symbol are bad requests", async () => {
  await assert.rejects(() => getCandles("INFY", { interval: "2h" }), (error) => error.statusCode === 400);
  await assert.rejects(() => getCandles("", {}), (error) => error.statusCode === 400);
});
