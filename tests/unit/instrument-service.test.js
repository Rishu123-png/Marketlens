import test from "node:test";
import assert from "node:assert/strict";
import { getInstrument } from "../../shared/instruments/catalog.js";
import {
  buildInstrumentMatrix,
  instrumentAvailability,
  publicInstrument,
  searchInstrumentMaster
} from "../../server/instruments/service.js";

test("availability distinguishes mapped providers from configured ones", () => {
  const availability = instrumentAvailability(getInstrument("IN-EQ-TCS"));
  assert.deepEqual(availability.mappedProviders.sort(), ["alpha", "fmp", "twelve"]);
  assert.equal(availability.providerSymbols.fmp, "TCS.NS");
  assert.equal(availability.providerSymbols.alpha, "TCS.NSE");

  const previous = process.env.FMP_API_KEY;
  process.env.FMP_API_KEY = "test-key";
  try {
    const configured = instrumentAvailability(getInstrument("IN-EQ-TCS"));
    assert.ok(configured.quoteProviders.includes("fmp"));
    assert.ok(configured.candleProviders.includes("twelve") === false);
  } finally {
    if (previous === undefined) delete process.env.FMP_API_KEY;
    else process.env.FMP_API_KEY = previous;
  }
});

test("a catalogued instrument is not presented as verified without observation", () => {
  const payload = publicInstrument(getInstrument("IN-EQ-HINDUNILVR"));
  assert.equal(payload.availability.quoteVerifiedRecently, false);
  assert.equal(payload.availability.lastQuoteAt, null);
});

test("coverage matrix reports real denominators and honesty flags without keys", () => {
  const matrix = buildInstrumentMatrix();
  assert.ok(matrix.catalogued >= 100);
  assert.equal(matrix.coverage.catalogued, matrix.catalogued);
  assert.ok(matrix.coverage.quoteEnabled <= matrix.catalogued);
  assert.equal(matrix.honesty.cataloguedDoesNotMeanQuoted, true);
  assert.equal(matrix.freshness.classification, "delayed");
  assert.equal(matrix.coverage.realtime, 0);
  assert.ok(matrix.byExchange.NSE.catalogued > 0);
});

test("search covers name, symbol, exchange and asset type", async () => {
  const byName = await searchInstrumentMaster("bajaj auto", {}, { limit: 5, includeDirectory: false });
  assert.equal(byName.instruments[0].symbol, "BAJAJ-AUTO");

  const byType = await searchInstrumentMaster("", { assetType: "etf", country: "IN" }, { limit: 10, includeDirectory: false });
  assert.ok(byType.total >= 1);
  assert.ok(byType.instruments.every((instrument) => instrument.assetType === "etf"));

  const byExchange = await searchInstrumentMaster("", { exchange: "BSE" }, { limit: 10, includeDirectory: false });
  assert.ok(byExchange.instruments.every((instrument) => instrument.exchange === "BSE"));
});
