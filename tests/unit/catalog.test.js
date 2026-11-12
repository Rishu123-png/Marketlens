import test from "node:test";
import assert from "node:assert/strict";
import {
  INSTRUMENTS,
  POPULAR_INDIAN_EQUITY_IDS,
  findInstrumentBySymbol,
  getInstrument,
  instrumentFromSymbol,
  listInstruments,
  resolveProviderSymbol,
  searchInstruments,
  supportsProvider
} from "../../shared/instruments/catalog.js";

test("every instrument has a unique stable id", () => {
  const ids = INSTRUMENTS.map((instrument) => instrument.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const instrument of INSTRUMENTS) {
    assert.match(instrument.id, /^(IN|US)-(EQ|IDX|ETF)-[A-Z0-9]+(-BSE)?$/);
  }
});

test("the legacy popular list is still the curated 20 NSE equities", () => {
  assert.equal(POPULAR_INDIAN_EQUITY_IDS.length, 20);
  assert.equal(POPULAR_INDIAN_EQUITY_IDS[0], "IN-EQ-RELIANCE");
  for (const id of POPULAR_INDIAN_EQUITY_IDS) {
    const instrument = getInstrument(id);
    assert.equal(instrument.country, "IN");
    assert.equal(instrument.assetType, "equity");
    assert.equal(instrument.currency, "INR");
  }
});

test("catalog covers equities, indices and ETFs across two markets", () => {
  const types = new Set(INSTRUMENTS.map((instrument) => instrument.assetType));
  assert.deepEqual([...types].sort(), ["equity", "etf", "index"]);
  assert.ok(INSTRUMENTS.length >= 100, "the bundled master is no longer a 40-instrument list");

  const countries = new Set(INSTRUMENTS.map((instrument) => instrument.country));
  assert.ok(countries.has("IN"));
  assert.ok(countries.has("US"));
});

test("getInstrument is case-insensitive and returns null for unknown ids", () => {
  assert.equal(getInstrument("in-eq-reliance")?.symbol, "RELIANCE");
  assert.equal(getInstrument("IN-EQ-NOPE"), null);
  assert.equal(getInstrument(null), null);
});

test("findInstrumentBySymbol prefers the equity listing for a reused symbol", () => {
  assert.equal(findInstrumentBySymbol("RELIANCE", "NSE")?.id, "IN-EQ-RELIANCE");
  assert.equal(findInstrumentBySymbol("reliance")?.id, "IN-EQ-RELIANCE");
  assert.equal(findInstrumentBySymbol("^NSEI")?.id, "IN-IDX-NIFTY50");
  assert.equal(findInstrumentBySymbol("NOTREAL"), null);
});

test("provider tickers follow exchange conventions for Indian equities", () => {
  const reliance = getInstrument("IN-EQ-RELIANCE");
  assert.equal(resolveProviderSymbol(reliance, "fmp"), "RELIANCE.NS");
  assert.equal(resolveProviderSymbol(reliance, "twelve"), "NSE:RELIANCE");
  assert.equal(resolveProviderSymbol(reliance, "alpha"), "RELIANCE.NSE");

  const apple = getInstrument("US-EQ-AAPL");
  assert.equal(resolveProviderSymbol(apple, "fmp"), "AAPL");
  assert.equal(resolveProviderSymbol(apple, "twelve"), "AAPL");
});

test("unmapped instruments are reported unsupported instead of guessing a ticker", () => {
  const nifty = getInstrument("IN-IDX-NIFTY50");
  assert.equal(resolveProviderSymbol(nifty, "fmp"), "^NSEI");
  assert.equal(resolveProviderSymbol(nifty, "twelve"), null);
  assert.equal(supportsProvider(nifty, "twelve"), false);

  const spy = getInstrument("US-ETF-SPY");
  assert.equal(resolveProviderSymbol(spy, "fmp"), "SPY");
  assert.equal(supportsProvider(spy, "twelve"), true);

  const niftyBees = getInstrument("IN-ETF-NIFTYBEES");
  assert.equal(resolveProviderSymbol(niftyBees, "fmp"), "NIFTYBEES.NS");
  assert.equal(resolveProviderSymbol(niftyBees, "twelve"), "NSE:NIFTYBEES");
});

test("a symbol outside the catalog becomes a derived, exchange-aware instrument", () => {
  const nse = instrumentFromSymbol("newlisting", "NSE");
  assert.equal(nse.symbol, "NEWLISTING");
  assert.equal(nse.country, "IN");
  assert.equal(nse.currency, "INR");
  assert.equal(resolveProviderSymbol(nse, "fmp"), "NEWLISTING.NS");

  const bse = instrumentFromSymbol("NEWLISTING", "BSE");
  assert.equal(resolveProviderSymbol(bse, "fmp"), "NEWLISTING.BO");

  const known = instrumentFromSymbol("RELIANCE", "NSE");
  assert.equal(known.id, "IN-EQ-RELIANCE");
});

test("search ranks exact ticker matches above name and sector matches", () => {
  const bySymbol = searchInstruments("NVDA");
  assert.equal(bySymbol[0].id, "US-EQ-NVDA");

  const byName = searchInstruments("microsoft");
  assert.equal(byName[0].id, "US-EQ-MSFT");

  assert.ok(searchInstruments("nifty").some((instrument) => instrument.id === "IN-IDX-NIFTY50"));
  assert.deepEqual(searchInstruments("zzzzzz"), []);
});

test("filters narrow the catalog by country, asset type and exchange", () => {
  const indianIndices = listInstruments({ country: "IN", assetType: "index" });
  assert.deepEqual(
    indianIndices.map((instrument) => instrument.id).sort(),
    ["IN-IDX-NIFTY50", "IN-IDX-NIFTYBANK", "IN-IDX-NIFTYIT", "IN-IDX-SENSEX"]
  );

  const nasdaq = listInstruments({ exchange: "NASDAQ", assetType: "equity" });
  assert.ok(nasdaq.length >= 5);
  assert.ok(nasdaq.every((instrument) => instrument.country === "US"));

  const both = listInstruments({ assetType: ["equity", "etf"], country: "US" });
  assert.ok(both.some((instrument) => instrument.assetType === "etf"));
  assert.ok(both.some((instrument) => instrument.assetType === "equity"));
});

test("search respects filters", () => {
  const results = searchInstruments("s", { country: "IN", assetType: "index" });
  assert.ok(results.every((instrument) => instrument.country === "IN"));
});
