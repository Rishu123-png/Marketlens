import test from "node:test";
import assert from "node:assert/strict";
import { getInstrument, POPULAR_INDIAN_EQUITY_IDS } from "../../shared/instruments/catalog.js";
import { buildMarketOverview, marketSession } from "../../server/market/overview.js";

const stamp = "2026-11-12T09:00:00.000Z";

function quote(instrument, overrides = {}) {
  return {
    price: 100,
    currency: instrument.currency,
    change: 1,
    changePercent: 1,
    volume: 1000,
    source: "Test provider",
    provider: "test",
    providerTimestamp: stamp,
    retrievedAt: stamp,
    ...overrides
  };
}

function entry(instrument, overrides) {
  return { instrument, quote: quote(instrument, overrides), error: null };
}

test("market session is computed in IST and does not invent a holiday calendar", () => {
  const open = marketSession(new Date("2026-11-12T05:00:00Z")); // 10:30 IST Thursday
  assert.equal(open.status, "open");
  assert.equal(open.holidayCalendar, "not-verified");

  const closed = marketSession(new Date("2026-11-12T12:00:00Z")); // 17:30 IST
  assert.equal(closed.status, "closed");
  assert.equal(marketSession(new Date("2026-11-14T05:00:00Z")).status, "weekend");
});

test("breadth and sectors are derived only from verified quotes", async () => {
  const entries = [
    entry(getInstrument("IN-EQ-RELIANCE"), { changePercent: 2 }),
    entry(getInstrument("IN-EQ-TCS"), { changePercent: -1 }),
    entry(getInstrument("IN-EQ-HDFCBANK"), { changePercent: 0 }),
    { instrument: getInstrument("IN-EQ-INFY"), quote: null, error: { message: "no quote", details: [{ provider: "fmp", message: "not mapped" }] } },
    entry(getInstrument("IN-IDX-NIFTY50"), { changePercent: 0.5, price: 25000 })
  ];

  const overview = await buildMarketOverview({ quotes: entries, now: new Date("2026-11-12T05:00:00Z") });
  assert.equal(overview.breadth.verified, 3);
  assert.equal(overview.breadth.unverified, 1);
  assert.equal(overview.breadth.advancers, 1);
  assert.equal(overview.breadth.decliners, 1);
  assert.equal(overview.breadth.unchanged, 1);
  assert.equal(overview.breadth.changesAvailable, 3);
  assert.deepEqual(overview.gainers.map((item) => item.symbol), ["RELIANCE"]);
  assert.deepEqual(overview.losers.map((item) => item.symbol), ["TCS"]);
  assert.equal(overview.indices.length, 1);
  assert.equal(overview.coverage.verified, 4);
  assert.equal(overview.coverage.attempted, 5);
  assert.equal(overview.coverage.status, "partial-coverage");
  assert.equal(overview.heatmap.find((tile) => tile.symbol === "INFY").verified, false);
  assert.ok(overview.sectors.some((sector) => sector.sector === "Banking"));
  assert.equal(overview.sectors.find((sector) => sector.sector === "Banking").count, 1);
});

test("no verified quotes produces an explicit no-coverage result, not placeholder data", async () => {
  const entries = POPULAR_INDIAN_EQUITY_IDS.slice(0, 3).map((id) => ({
    instrument: getInstrument(id),
    quote: null,
    error: { message: "unavailable", details: [{ provider: "fmp", message: "no price" }] }
  }));

  const overview = await buildMarketOverview({ quotes: entries, now: new Date("2026-11-12T05:00:00Z") });
  assert.equal(overview.coverage.verified, 0);
  assert.equal(overview.coverage.status, "no-verified-quotes");
  assert.equal(overview.breadth.verified, 0);
  assert.equal(overview.breadth.advancePercent, null);
  assert.deepEqual(overview.gainers, []);
  assert.ok(overview.heatmap.every((tile) => tile.verified === false && tile.price === null));
});


test("a verified price without a reported change does not invent flat breadth or movers", async () => {
  const entries = [
    entry(getInstrument("IN-EQ-TCS"), { changePercent: null, volume: null }),
    entry(getInstrument("IN-EQ-INFY"), { changePercent: undefined })
  ];
  const overview = await buildMarketOverview({ quotes: entries, now: new Date("2026-11-12T05:00:00Z") });
  assert.equal(overview.breadth.verified, 2);
  assert.equal(overview.featuredStocks.find((item) => item.symbol === "TCS").quote.price, 100);
  assert.equal(overview.breadth.changesAvailable, 0);
  assert.equal(overview.breadth.advancePercent, null);
  assert.equal(overview.breadth.unchanged, 0);
  assert.deepEqual(overview.gainers, []);
  assert.deepEqual(overview.losers, []);
  assert.deepEqual(overview.sectors, []);
  assert.ok(overview.heatmap.every((tile) => tile.changePercent === null));
});
