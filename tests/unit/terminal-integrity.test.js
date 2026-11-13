import test from "node:test";
import assert from "node:assert/strict";
import { quoteState, summarizeQuotes, marketCoverage } from "../../src/lib/marketVisuals.js";
import { defaultInstrument } from "../../src/lib/instruments.js";
import { computeSignals, backtest } from "../../src/lib/backtest.js";
import { simulateMarketOrder, simulateLimitOrder, verifiedQuoteForInstrument } from "../../src/lib/virtualAccount.js";
import { evaluateLocalAlert } from "../../src/lib/localAlerts.js";
import { credentialSelection } from "../../src/lib/aiRouting.js";
import { canPublishReport } from "../../src/lib/researchGate.js";

const now = Date.parse("2026-11-12T10:00:00Z");
const instrument = { id: "IN-EQ-TCS", symbol: "TCS", name: "Tata Consultancy Services", exchange: "NSE", currency: "INR", assetType: "equity" };
const quote = { mode: "verified", quoteVerified: true, instrumentId: instrument.id, symbol: "TCS", exchange: "NSE", assetType: "equity", currency: "INR", price: 100, changePercent: 1, providerTimestamp: "2026-11-12T09:00:00Z", retrievedAt: "2026-11-12T10:00:00Z", source: "fixture" };
const account = { startingCash: 100_000, cash: 100_000, positions: [], orders: [], equityHistory: [] };
const orderMeta = { id: "ord-test", at: "2026-11-12T10:00:00Z" };

test("ticker summaries count quotes, not catalog entries, and coverage uses the instrument section", () => {
  const indices = [{ quote: null }, { quote: null }, { quote: null }, { quote: null }];
  assert.deepEqual(summarizeQuotes(indices, now), { count: 0, code: "unavailable", label: "NO VERIFIED QUOTES" });
  assert.equal(summarizeQuotes([{ quote }, { quote: null }], now).count, 1);
  assert.equal(marketCoverage({ coverage: { unrelated: true }, instruments: { coverage: { verifiedLatestQuote: 3 } } }).verifiedLatestQuote, 3);
  assert.equal(marketCoverage({ coverage: {} }), null);
});

test("quote freshness is based on provider timestamp, never retrieval timestamp", () => {
  assert.equal(quoteState(null, now).code, "unavailable");
  assert.equal(quoteState({ ...quote, quoteVerified: false }, now).code, "unavailable");
  const { quoteVerified, ...summaryQuote } = quote;
  assert.equal(quoteState(summaryQuote, now).code, "unavailable");
  assert.equal(quoteState(summaryQuote, now, { verifiedByContract: true }).code, "delayed");
  assert.equal(quoteState({ ...summaryQuote, quoteVerified: false }, now, { verifiedByContract: true }).code, "unavailable");
  assert.equal(quoteState(quote, now).code, "delayed");
  assert.equal(quoteState({ ...quote, providerTimestamp: null }, now).label, "VERIFIED · TIME UNKNOWN");
  assert.equal(quoteState({ ...quote, providerTimestamp: "2026-11-01T00:00:00Z" }, now).code, "stale");
  assert.equal(quoteState({ ...quote, providerTimestamp: "2026-11-09T00:00:00Z" }, now).code, "historical");
  assert.equal(quoteState({ ...quote, providerTimestamp: "2027-01-01T00:00:00Z" }, now).code, "stale");
  assert.equal(quoteState({ ...quote, live: true, providerTimestamp: "2026-11-12T09:59:00Z" }, now).code, "live");
  assert.equal(quoteState({ ...quote, live: true, providerTimestamp: "2026-11-01T00:00:00Z" }, now).code, "stale");
  assert.equal(quoteState({ ...quote, realtime: true, providerTimestamp: null }, now).code, "stale");
});

test("default instruments are catalog identities per selected venue", () => {
  assert.deepEqual([defaultInstrument("NSE").symbol, defaultInstrument("BSE").symbol, defaultInstrument("NASDAQ").symbol, defaultInstrument("NYSE").symbol], ["TCS", "TCS", "AAPL", "JPM"]);
});

test("virtual market fills require a matching verified INR quote and never mutate input", () => {
  assert.equal(verifiedQuoteForInstrument(quote, instrument), true);
  const ok = simulateMarketOrder(account, { instrument, side: "BUY", qty: 2, quote, ...orderMeta });
  assert.equal(ok.ok, true);
  assert.equal(ok.order.status, "FILLED");
  assert.equal(ok.order.quoteSource, "fixture");
  assert.equal(account.positions.length, 0);
  assert.equal(ok.account.positions[0].qty, 2);
  assert.ok(ok.account.cash < account.cash - 200);
  for (const invalid of [null, { ...quote, quoteVerified: false }, { ...quote, exchange: "BSE" }, { ...quote, symbol: "INFY" }, { ...quote, instrumentId: "IN-EQ-INFY" }, { ...quote, price: null }]) {
    assert.equal(simulateMarketOrder(account, { instrument, side: "BUY", qty: 1, quote: invalid, ...orderMeta }).ok, false);
  }
  assert.equal(simulateMarketOrder(account, { instrument: { ...instrument, exchange: "NASDAQ" }, side: "BUY", qty: 1, quote: { ...quote, exchange: "NASDAQ", currency: "USD" }, ...orderMeta }).ok, false);
  assert.equal(simulateMarketOrder(account, { instrument, side: "SELL", qty: 1, quote, ...orderMeta }).ok, false);
});

test("virtual limit orders remain pending and are isolated from unsupported assets", () => {
  const pending = simulateLimitOrder(account, { instrument, side: "BUY", qty: 2, limitPrice: 90, currency: "INR", ...orderMeta });
  assert.equal(pending.ok, true);
  assert.equal(pending.order.status, "PENDING");
  assert.equal(pending.account.cash, account.cash);
  assert.equal(simulateLimitOrder(account, { instrument: { ...instrument, assetType: "index" }, side: "BUY", qty: 2, limitPrice: 90, currency: "INR", ...orderMeta }).ok, false);
});

test("local alerts ignore absent, stale, or timestamp-unknown values", () => {
  const above = { type: "changeAbove", threshold: "0" };
  assert.ok(evaluateLocalAlert(above, quote, now));
  assert.equal(evaluateLocalAlert({ type: "changeBelow", threshold: "1" }, { ...quote, changePercent: null }, now), null);
  assert.equal(evaluateLocalAlert(above, { ...quote, providerTimestamp: null }, now), null);
  assert.equal(evaluateLocalAlert(above, { ...quote, providerTimestamp: "2026-11-01T00:00:00Z" }, now), null);
});

test("backtest final equity includes terminal liquidation and costs", () => {
  const candles = [
    { time: "2026-01-01", open: 100, close: 100 },
    { time: "2026-01-02", open: 100, close: 110 },
    { time: "2026-01-03", open: 110, close: 120 }
  ];
  const result = backtest(candles, [1, 1, 1], { startingCapital: 1000, feeRate: 0.01, slippageRate: 0.01 });
  assert.equal(result.trades.length, 1);
  assert.equal(result.finalEquity, result.equity.at(-1).value);
  assert.equal(result.finalEquity, result.trades[0].proceeds);
  assert.ok(Math.abs(result.totalReturn - (result.finalEquity / 1000 - 1) * 100) < 1e-10);
  assert.ok(result.finalEquity < 1200);
  assert.equal(result.benchmark.at(-1).value, 1200);
});

test("strategy validation refuses missing RSI, negative fees and invalid windows", () => {
  const candles = Array.from({ length: 40 }, (_, i) => ({ time: `day-${i}`, open: 100 + i, close: 100 + i }));
  assert.throws(() => computeSignals(candles, { strategy: "rsi", rsiEntry: 30, rsiExit: 55, rsiSeries: [] }), /No aligned RSI/);
  assert.throws(() => computeSignals(candles, { strategy: "sma", fast: 20, slow: 20 }), /shorter/);
  assert.throws(() => backtest(candles, candles.map(() => 0), { startingCapital: 100, feeRate: -0.1, slippageRate: 0 }), /between/);
  const signals = computeSignals(candles, { strategy: "rsi", rsiEntry: 30, rsiExit: 55, rsiSeries: [{ time: "day-15", value: 25 }, { time: "day-20", value: 60 }] });
  assert.equal(signals[15], 1);
  assert.equal(signals[20], 0);
});


test("AI credential routing reports the selected key, not just the dedicated variable name", () => {
  const fallback = { envName: "GROQ_API_KEY", configured: true };
  const dedicated = { envName: "GROQ_API_KEY_CHART", configured: true, selected: "dedicated", mode: "dedicated" };
  assert.deepEqual(credentialSelection(dedicated, fallback), { mode: "dedicated", name: "GROQ_API_KEY_CHART" });
  assert.deepEqual(credentialSelection({ ...dedicated, configured: false, selected: "shared", mode: "shared" }, fallback), { mode: "shared", name: "GROQ_API_KEY" });
  assert.deepEqual(credentialSelection({ ...dedicated, configured: false, selected: "none", mode: "none" }, fallback), { mode: "none", name: "none" });
  assert.deepEqual(credentialSelection(null, fallback), { mode: "unknown", name: "not reported" });
});


test("stored research artefacts require matching valid passing gates on a completed job", () => {
  const passing = {
    verdict: "PASS", rulesVersion: "1.0.0", evaluatedAt: "2026-11-12T10:00:00Z",
    checks: [{ rule: "test", status: "pass", detail: "validated" }], blocking: [], warnings: []
  };
  const warn = { ...passing, verdict: "PASS_WITH_WARNINGS", warnings: [{ rule: "test", message: "warning" }] };
  const blocked = { ...passing, verdict: "BLOCKED", blocking: [{ rule: "test", message: "blocked" }] };
  const report = { jobId: "research_test001", gate: passing };
  const job = { jobId: "research_test001", status: "COMPLETED", gate: passing };
  assert.equal(canPublishReport(report, job), true);
  assert.equal(canPublishReport({ ...report, gate: warn }, { ...job, status: "PARTIAL", gate: warn }), true);
  assert.equal(canPublishReport({ ...report, gate: blocked }, { ...job, status: "BLOCKED", gate: blocked }), false);
  assert.equal(canPublishReport(report, { ...job, gate: blocked }), false);
  assert.equal(canPublishReport(report, { ...job, gate: null }), false);
  assert.equal(canPublishReport({ ...report, gate: null }, job), false);
  assert.equal(canPublishReport(report, { ...job, gate: { ...passing, evaluatedAt: "2026-11-12T10:01:00Z" } }), false);
  assert.equal(canPublishReport(report, { ...job, gate: { ...passing, blocking: [{ rule: "test", message: "contradiction" }] } }), false);
  assert.equal(canPublishReport(report, { ...job, status: "RUNNING" }), false);
  assert.equal(canPublishReport(report, { ...job, jobId: "research_other01" }), false);
  assert.equal(canPublishReport(null, job), false);
});
