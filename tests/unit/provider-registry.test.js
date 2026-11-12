import test from "node:test";
import assert from "node:assert/strict";
import { getInstrument } from "../../shared/instruments/catalog.js";
import {
  EVALUATED_PROVIDER_IDS,
  MARKET_DATA_REGISTRY_VERSION,
  PROVIDER_REGISTRY,
  buildProviderRegistry,
  providerSelectionPlan
} from "../../server/market-data/registry.js";
import { PROVIDER_CAPABILITIES } from "../../server/market-data/providers/index.js";
import { buildMarketDiagnostics } from "../../server/market-data/diagnostics.js";

test("registry declares every evaluated provider and rejects Yahoo for automated use", () => {
  assert.equal(MARKET_DATA_REGISTRY_VERSION, "2.0.0");
  assert.deepEqual([...EVALUATED_PROVIDER_IDS].sort(), ["alpha", "fmp", "twelve", "yahoo"]);

  for (const id of ["fmp", "twelve", "alpha"]) {
    const descriptor = PROVIDER_REGISTRY[id];
    assert.equal(descriptor.status, "active");
    assert.ok(descriptor.exchanges.includes("NSE"));
    assert.ok(descriptor.exchanges.includes("BSE"));
    assert.ok(descriptor.intervals.daily.includes("1day"));
    assert.equal(descriptor.quote.realtime, false, "no provider may claim real-time India without entitlement");
    assert.equal(descriptor.entitlement.freeTierCoversIndia, false);
    assert.ok(descriptor.licensing.permittedUse);
    assert.ok(descriptor.rateLimits.freeTier);
  }

  const yahoo = PROVIDER_REGISTRY.yahoo;
  assert.equal(yahoo.status, "rejected-terms");
  assert.equal(yahoo.enabled, false);
  assert.equal(yahoo.quote.supported, false);
  assert.match(yahoo.licensing.termsUrl, /yahoo\.com/);
});

test("flat provider capabilities now carry exchanges, entitlement and licensing without secrets", () => {
  const fmp = PROVIDER_CAPABILITIES.fmp;
  assert.ok(fmp.exchanges.includes("NSE"));
  assert.ok(fmp.instrumentTypes.includes("equity"));
  assert.equal(fmp.quoteFreshness, "delayed-or-eod");
  assert.equal(fmp.realtime, false);
  assert.equal(fmp.entitlement.indiaEquity, "paid-plan-or-entitled-account");
  assert.ok(fmp.licensing.display);
  assert.equal(JSON.stringify(fmp).includes("API_KEY="), false);
});

test("selection distinguishes unconfigured, unsupported and eligible providers", () => {
  const tcsNse = getInstrument("IN-EQ-TCS");
  const tcsBse = getInstrument("IN-EQ-TCS-BSE");

  const noneConfigured = providerSelectionPlan({ instrument: tcsNse, env: {} });
  assert.equal(noneConfigured.selected, null);
  assert.ok(noneConfigured.providers.every((provider) => ["unconfigured", "rejected"].includes(provider.state)));

  const fmpOnly = providerSelectionPlan({ instrument: tcsNse, env: { FMP_API_KEY: "present" } });
  assert.equal(fmpOnly.selected, "fmp");
  const selectedBse = fmpOnly.providers.find((provider) => provider.provider === "fmp");
  assert.equal(selectedBse.mapping, "TCS.NS");
  assert.equal(selectedBse.selected, true);

  const bse = providerSelectionPlan({ instrument: tcsBse, env: { FMP_API_KEY: "present" } });
  assert.equal(bse.providers.find((provider) => provider.provider === "fmp").mapping, "TCS.BO");

  const nifty = providerSelectionPlan({ instrument: getInstrument("IN-IDX-NIFTY50"), env: { FMP_API_KEY: "present", TWELVE_DATA_API_KEY: "present" } });
  const twelve = nifty.providers.find((provider) => provider.provider === "twelve");
  assert.equal(twelve.state, "unsupported");
  assert.equal(twelve.mapping, null, "indices are never given a guessed provider ticker");

  const derivative = providerSelectionPlan({ instrument: getInstrument("IN-FUT-NIFTY50-FRONT"), env: { FMP_API_KEY: "present" } });
  assert.equal(derivative.selected, null);
  assert.ok(derivative.providers.every((provider) => provider.state !== "eligible"));
});

test("interval selection is explicit: weekly is not intraday, and 4h is not daily", () => {
  const apple = getInstrument("US-EQ-AAPL");
  const env = { ALPHA_VANTAGE_API_KEY: "present" };

  const weekly = providerSelectionPlan({ instrument: apple, capability: "candles", interval: "1week", env });
  assert.equal(weekly.selected, "alpha");
  assert.equal(weekly.providers.find((provider) => provider.provider === "alpha").intervalSupported, true);

  const intraday = providerSelectionPlan({ instrument: apple, capability: "candles", interval: "5min", env });
  assert.equal(intraday.selected, null);
  assert.equal(intraday.providers.find((provider) => provider.provider === "alpha").state, "unsupported-interval");
});

test("registry snapshot never echoes a credential and reports runtime health separately", () => {
  const secret = "registry-secret-do-not-return";
  const snapshot = buildProviderRegistry({
    env: { FMP_API_KEY: secret, TWELVE_DATA_API_KEY: "" },
    policy: { providers: { fmp: { circuit: "open", reason: "quota-exhausted", quota: { remainingRequests: 0 } } } }
  });

  assert.equal(snapshot.providers.fmp.configured, true);
  assert.equal(snapshot.providers.twelve.configured, false);
  assert.equal(snapshot.providers.fmp.health.circuit, "open");
  assert.equal(snapshot.providers.fmp.health.reason, "quota-exhausted");
  assert.equal(JSON.stringify(snapshot).includes(secret), false);
});

test("market diagnostics expose interval coverage and per-instrument selection plans", () => {
  const diagnostics = buildMarketDiagnostics({
    env: { FMP_API_KEY: "present" },
    now: () => new Date("2026-11-12T10:00:00.000Z")
  });

  assert.equal(diagnostics.registry.version, "2.0.0");
  assert.equal(diagnostics.registry.providers.yahoo.status, "rejected-terms");
  assert.equal(diagnostics.intervalCoverage.NSE["1day"].status, "configured-unverified");
  assert.equal(diagnostics.intervalCoverage.NSE["1min"].status, "configured-unverified");
  assert.equal(diagnostics.intervalCoverage.NSE["1month"].status, "declared-not-configured");
  assert.equal(diagnostics.providerSelection["IN-EQ-TCS"].quote.selected, "fmp");
  assert.equal(diagnostics.providerSelection["IN-EQ-TCS-BSE"].dailyCandles.providers[0].mapping, "TCS.BO");
  assert.equal(diagnostics.providerSelection["IN-FUT-NIFTY50-FRONT"].quote.selected, null);
  assert.equal(diagnostics.instrumentCoverage.realtime, 0);
  assert.ok(diagnostics.instrumentMatrix.some((entry) => entry.id === "IN-EQ-HINDUNILVR"));
});
