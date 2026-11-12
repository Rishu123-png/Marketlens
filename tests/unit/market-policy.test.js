import test from "node:test";
import assert from "node:assert/strict";
import { getInstrument } from "../../shared/instruments/catalog.js";
import { normalizeQuote } from "../../server/market-data/normalize.js";
import { fmpProvider } from "../../server/market-data/providers/fmp.js";
import {
  checkProvider,
  providerPolicySnapshot,
  quotaFromHeaders,
  recordProviderFailure,
  resetProviderPolicyForTests
} from "../../server/market-data/providerPolicy.js";
import { fetchJson } from "../../server/market-data/http.js";
import { clearQuoteCache, getVerifiedQuote } from "../../server/market-data/gateway.js";
import { clearCandleCache, getCandles } from "../../server/market-data/candles.js";
import { instrumentAvailability, buildInstrumentMatrix } from "../../server/instruments/service.js";

const reliance = getInstrument("IN-EQ-RELIANCE");

function withEnv(values, callback) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  return Promise.resolve(callback()).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("quota headers are reduced to numbers and never expose credentials", () => {
  const headers = new Headers({
    "x-ratelimit-remaining-requests": "7",
    "x-ratelimit-limit-requests": "8",
    "api-credits-used": "1",
    authorization: "Bearer should-not-be-read"
  });
  assert.deepEqual(quotaFromHeaders(headers), {
    remainingRequests: 7,
    limitRequests: 8,
    usedCredits: 1,
    reset: null
  });
  assert.equal(quotaFromHeaders(new Headers({ authorization: "x" })), null);
});

test("a 429 opens the provider circuit and blocks the next attempt", async () => {
  resetProviderPolicyForTests();
  const error = Object.assign(new Error("API limit reached"), { status: 429, retryAfterSeconds: 30 });
  await recordProviderFailure("stub", error);

  const verdict = await checkProvider("stub");
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reason, "rate-limited");
  assert.ok(verdict.retryAfterSeconds > 0 && verdict.retryAfterSeconds <= 30);

  const snapshot = providerPolicySnapshot();
  assert.equal(snapshot.providers.stub.circuit, "open");
  assert.match(snapshot.providers.stub.lastError, /limit/);
  assert.equal(JSON.stringify(snapshot).includes("apikey"), false);
  resetProviderPolicyForTests();
});

test("a quota-exhausted message holds the provider until the next UTC day", async () => {
  resetProviderPolicyForTests();
  const now = Date.UTC(2026, 10, 12, 10, 0, 0);
  await recordProviderFailure("stub", Object.assign(new Error("daily limit reached"), { status: 429 }), { now });
  const verdict = await checkProvider("stub", { now });
  assert.equal(verdict.reason, "quota-exhausted");
  assert.ok(verdict.retryAfterSeconds > 12 * 60 * 60);
  resetProviderPolicyForTests();
});

test("fetchJson records a quota header without recording the request URL", async () => {
  resetProviderPolicyForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ ok: true }, { headers: { "x-ratelimit-remaining-requests": "3" } });
  try {
    await fetchJson("https://provider.example/quote?apikey=secret", { providerId: "stub" });
    const snapshot = providerPolicySnapshot();
    assert.equal(snapshot.providers.stub.quota.remainingRequests, 3);
    assert.equal(JSON.stringify(snapshot).includes("provider.example"), false);
    assert.equal(JSON.stringify(snapshot).includes("secret"), false);
  } finally {
    globalThis.fetch = originalFetch;
    resetProviderPolicyForTests();
  }
});

test("a plain-text premium error page opens the circuit instead of retrying forever", async () => {
  resetProviderPolicyForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("Premium Query Parameter: not available under your current subscription; upgrade your plan", {
      status: 200,
      headers: { "content-type": "text/plain" }
    });
  try {
    await assert.rejects(() => fetchJson("https://provider.example/quote", { providerId: "fmp" }), /Premium/);
    const verdict = await checkProvider("fmp");
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.reason, "permission-or-endpoint");
    assert.equal(providerPolicySnapshot().providers.fmp.lastHttpStatus, 403);
  } finally {
    globalThis.fetch = originalFetch;
    resetProviderPolicyForTests();
  }
});

test("FMP uses the stable quote endpoint and never falls back to a bare NSE ticker", async () => {
  resetProviderPolicyForTests();
  await withEnv({ FMP_API_KEY: "test-key" }, async () => {
    const requested = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      requested.push(String(url));
      return Response.json([
        {
          symbol: "RELIANCE.NS",
          price: 1450.5,
          change: 12.3,
          changePercentage: 0.86,
          exchange: "NSE",
          timestamp: 1_700_000_000
        }
      ]);
    };

    try {
      const quote = await fmpProvider.fetchQuote(reliance);
      assert.equal(quote.price, 1450.5);
      assert.equal(quote.changePercent, 0.86);
      assert.equal(quote.provider, "fmp");
      assert.equal(requested.length, 1);
      assert.match(requested[0], /\/stable\/quote\?symbol=RELIANCE\.NS&apikey=/);
      assert.equal(requested[0].includes("symbol=RELIANCE&"), false);
    } finally {
      globalThis.fetch = originalFetch;
      resetProviderPolicyForTests();
    }
  });
});

test("FMP daily candles come from the stable EOD endpoint and are sorted ascending", async () => {
  resetProviderPolicyForTests();
  await withEnv({ FMP_API_KEY: "test-key" }, async () => {
    const requested = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      requested.push(String(url));
      return Response.json([
        { date: "2026-11-11", open: 3, high: 4, low: 2, close: 3.5, volume: 20 },
        { date: "2026-11-10", open: 1, high: 3, low: 1, close: 2, volume: 10 }
      ]);
    };

    try {
      const series = await fmpProvider.fetchCandles(reliance, { interval: "1day", limit: 2 });
      assert.equal(series.length, 2);
      assert.ok(series[0].time < series[1].time);
      assert.match(requested[0], /\/stable\/historical-price-eod\/full\?symbol=RELIANCE\.NS/);
      assert.equal(fmpProvider.supportsCandleInterval("1week"), false);
    } finally {
      globalThis.fetch = originalFetch;
      resetProviderPolicyForTests();
    }
  });
});

test("concurrent identical quote requests are deduplicated and then served from cache", async () => {
  resetProviderPolicyForTests();
  clearQuoteCache();
  let calls = 0;
  const provider = {
    id: "stub-policy",
    label: "Stub",
    isConfigured: () => true,
    supports: () => true,
    async fetchQuote(instrument) {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return normalizeQuote({
        item: { symbol: instrument.symbol, price: 100, exchange: instrument.exchange },
        instrument,
        source: "Stub",
        provider: "stub-policy"
      });
    }
  };

  const [first, second] = await Promise.all([
    getVerifiedQuote(reliance, { providers: [provider] }),
    getVerifiedQuote(reliance, { providers: [provider] })
  ]);
  assert.equal(calls, 1);
  assert.equal(first.price, 100);
  assert.equal(second.price, 100);

  const third = await getVerifiedQuote(reliance, { providers: [provider] });
  assert.equal(calls, 1);
  assert.equal(third.cached, true);
  clearQuoteCache();
  resetProviderPolicyForTests();
});

test("an open circuit skips a provider and reports why, without calling it", async () => {
  resetProviderPolicyForTests();
  clearCandleCache();
  await recordProviderFailure("stub-candles", Object.assign(new Error("daily limit reached"), { status: 429 }));
  let calls = 0;
  const provider = {
    id: "stub-candles",
    label: "Stub candles",
    isConfigured: () => true,
    supports: () => true,
    supportsCandleInterval: () => true,
    async fetchCandles() {
      calls += 1;
      throw new Error("must not be called");
    }
  };

  await assert.rejects(
    () => getCandles(reliance, { providers: [provider], interval: "1day", limit: 30, cache: false }),
    /No configured provider could return historical candles/
  );
  assert.equal(calls, 0);
  clearCandleCache();
  resetProviderPolicyForTests();
});

test("coverage separates supported, enabled, verified and unavailable counts", () => {
  const availability = instrumentAvailability(reliance);
  assert.equal(availability.quoteSupported, true);
  assert.equal(availability.candleSupported, true);
  assert.equal(typeof availability.unavailableFromAllConfigured, "boolean");

  const matrix = buildInstrumentMatrix();
  for (const field of [
    "catalogued",
    "quoteSupported",
    "quoteEnabled",
    "verifiedLatestQuote",
    "candleSupported",
    "candleEnabled",
    "verifiedHistoricalCandles",
    "unavailableFromAllConfigured"
  ]) {
    assert.equal(typeof matrix.coverage[field], "number", `${field} must be a count`);
  }
  assert.equal(matrix.honesty.supportedIsNotVerified, true);
});
