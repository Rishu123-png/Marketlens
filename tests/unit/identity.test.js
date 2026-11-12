import test from "node:test";
import assert from "node:assert/strict";
import { getInstrument } from "../../shared/instruments/catalog.js";
import { validateQuoteIdentity, expectedVenues } from "../../server/market-data/identity.js";

const tcs = getInstrument("IN-EQ-TCS");
const reliance = getInstrument("IN-EQ-RELIANCE");

test("a quote on the instrument's own venue and currency passes identity checks", () => {
  const result = validateQuoteIdentity(tcs, {
    providerSymbol: "TCS.NS",
    providerExchange: "NSE",
    providerCurrency: "INR"
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, null);
  assert.equal(result.checks.instrumentCurrency, "INR");
});

test("the Container Store quote for TCS is rejected as cross-currency", () => {
  const result = validateQuoteIdentity(tcs, {
    providerSymbol: "TCS",
    providerExchange: "NYSE",
    providerCurrency: "USD"
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /cross-currency/);
});

test("a same-currency quote from the wrong exchange is rejected as a cross-listing", () => {
  const result = validateQuoteIdentity(reliance, {
    providerSymbol: "RELIANCE",
    providerExchange: "NASDAQ",
    providerCurrency: "INR"
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /listed on NSE/);
});

test("unknown venues are not treated as proof of a mismatch", () => {
  const result = validateQuoteIdentity(reliance, { providerSymbol: "RELIANCE", providerExchange: "SOMEWHERE" });
  assert.equal(result.ok, true);
});

test("index quotes skip venue identity but keep currency checks", () => {
  const nifty = getInstrument("IN-IDX-NIFTY50");
  assert.deepEqual(expectedVenues(nifty), ["NSE"]);
  assert.equal(validateQuoteIdentity(nifty, { providerExchange: "INDEX", providerCurrency: "INR" }).ok, true);
  assert.equal(validateQuoteIdentity(nifty, { providerCurrency: "USD" }).ok, false);
});
