import test from "node:test";
import assert from "node:assert/strict";
import { matchesQuoteFilters, parseScreenerFilters, technicalMatch, UNSUPPORTED_FILTERS } from "../../server/market/screener.js";

const filters = (overrides = {}) => ({ ...parseScreenerFilters(overrides).filters });

test("quote filters require a verified numeric value, not a missing one", () => {
  const row = { quote: { price: 1250, changePercent: -1.4, volume: 500000 } };
  assert.equal(matchesQuoteFilters(row, filters({ priceMin: "1000", priceMax: "1300" })), true);
  assert.equal(matchesQuoteFilters(row, filters({ priceMin: "1300" })), false);
  assert.equal(matchesQuoteFilters(row, filters({ changeMax: "-2" })), false);
  assert.equal(matchesQuoteFilters(row, filters({ volumeMin: "400000" })), true);
  assert.equal(matchesQuoteFilters({ quote: { price: null, changePercent: null, volume: null } }, filters({ priceMin: "1" })), false);
});

test("technical filters evaluate server indicators and reject missing values", () => {
  const indicators = {
    rsi: 62,
    lastClose: 120,
    movingAverages: { sma50: 110, sma200: 130 }
  };
  assert.equal(technicalMatch(indicators, filters({ smaCondition: "aboveSma50" })), true);
  assert.equal(technicalMatch(indicators, filters({ smaCondition: "aboveSma200" })), false);
  assert.equal(technicalMatch(indicators, filters({ rsiMin: "60", rsiMax: "70" })), true);
  assert.equal(technicalMatch(indicators, filters({ rsiMin: "70" })), false);
  assert.equal(technicalMatch({ rsi: null, lastClose: null, movingAverages: {} }, filters({ rsiMax: "80" })), false);
});

test("market-cap filters are refused explicitly rather than approximated", () => {
  const parsed = parseScreenerFilters({ marketCapMin: "1000" });
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0], /Market capitalisation/);
  assert.ok(UNSUPPORTED_FILTERS.marketCapMin);

  const badSma = parseScreenerFilters({ smaCondition: "crosses" });
  assert.ok(badSma.errors.some((line) => line.includes("smaCondition")));
});
