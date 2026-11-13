import test from "node:test";
import assert from "node:assert/strict";
import { advanceTicker, selectTickerMovers } from "../../src/lib/marketTicker.js";

function item(symbol, changePercent, overrides = {}) {
  return { symbol, quote: { price: 100, currency: "INR", changePercent, ...overrides } };
}

test("ticker selects up to ten verified gainers then up to ten verified losers in rank order", () => {
  const gainers = Array.from({ length: 12 }, (_, index) => item(`G${index}`, index + 1));
  const losers = Array.from({ length: 12 }, (_, index) => item(`L${index}`, -(index + 1))).reverse();
  const originalGainers = [...gainers];
  const originalLosers = [...losers];
  const result = selectTickerMovers({ gainers, losers });

  assert.deepEqual(result.gainers.map((entry) => entry.quote.changePercent), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  assert.deepEqual(result.losers.map((entry) => entry.quote.changePercent), [-12, -11, -10, -9, -8, -7, -6, -5, -4, -3]);
  assert.deepEqual(gainers, originalGainers);
  assert.deepEqual(losers, originalLosers);
});

test("ticker never fills gaps with flat, missing, wrong-sign, or explicitly unverified quotes", () => {
  const result = selectTickerMovers({
    gainers: [
      item("VALID", 2),
      item("UNVERIFIED", 10, { quoteVerified: false }),
      item("NO_PRICE", 9, { price: null }),
      item("FLAT", 0),
      item("NO_CHANGE", null),
      item("WRONG_SIGN", -2)
    ],
    losers: [item("DOWN", -1), item("WRONG_SIGN", 1), item("BAD_CHANGE", "bad")]
  });

  assert.deepEqual(result.gainers.map((entry) => entry.symbol), ["VALID"]);
  assert.deepEqual(result.losers.map((entry) => entry.symbol), ["DOWN"]);
  assert.deepEqual(selectTickerMovers(null), { gainers: [], losers: [] });
  assert.deepEqual(selectTickerMovers({ gainers: {}, losers: null }), { gainers: [], losers: [] });
});

test("ticker advances smoothly, wraps at the repeat, and caps a long frame", () => {
  assert.ok(Math.abs(advanceTicker(10, 50, 100) - 11.8) < 1e-9);
  assert.ok(Math.abs(advanceTicker(99, 100, 100) - 2.6) < 1e-9);
  assert.ok(Math.abs(advanceTicker(10, 5_000, 100) - 13.6) < 1e-9);
  assert.equal(advanceTicker(10, -1, 100), 10);
  assert.equal(advanceTicker(10, 50, 0), 10);
});
