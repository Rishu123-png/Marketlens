import test from "node:test";
import assert from "node:assert/strict";
import {
  clearQuoteCache,
  getVerifiedQuote,
  getVerifiedQuotes,
  mapConcurrent
} from "../../server/market-data/gateway.js";
import { getInstrument } from "../../shared/instruments/catalog.js";
import { normalizeQuote } from "../../server/market-data/normalize.js";

function stubProvider(id, { quote, error, supported = true, onCall } = {}) {
  return {
    id,
    label: id,
    supports: () => supported,
    isConfigured: () => true,
    async fetchQuote() {
      onCall?.();
      if (error) throw error;
      return quote;
    }
  };
}

const stubInstrument = getInstrument("IN-EQ-RELIANCE");

/**
 * Contract-valid stub quote. Built through the real normalizer so the test
 * fixtures cannot drift from the shape providers must actually produce.
 */
const verifiedQuote = (overrides = {}) => ({
  ...normalizeQuote({
    item: { price: 100 },
    instrument: stubInstrument,
    source: "Stub",
    provider: "stub"
  }),
  ...overrides
});

test("falls through providers in order and records the failures", async () => {
  clearQuoteCache();
  const quote = await getVerifiedQuote("STUBFALL", {
    exchange: "NSE",
    cache: false,
    providers: [
      stubProvider("first", { error: new Error("boom") }),
      stubProvider("second", { quote: verifiedQuote({ price: 250, provider: "second" }) })
    ]
  });

  assert.equal(quote.price, 250);
  assert.equal(quote.provider, "second");
  assert.equal(quote.fallbackUsed, true);
  assert.equal(quote.providerErrors.length, 1);
  assert.equal(quote.providerErrors[0].provider, "first");
  assert.match(quote.providerErrors[0].message, /boom/);
});

test("skips a provider that cannot map the instrument", async () => {
  clearQuoteCache();
  let called = false;
  const quote = await getVerifiedQuote(getInstrument("IN-IDX-NIFTY50"), {
    cache: false,
    providers: [
      stubProvider("unmapped", { supported: false, onCall: () => { called = true; } }),
      stubProvider("mapped", { quote: verifiedQuote({ price: 22000, provider: "mapped" }) })
    ]
  });

  assert.equal(called, false);
  assert.equal(quote.provider, "mapped");
  assert.match(quote.providerErrors[0].message, /not mapped/i);
});

test("throws a 503 with per-provider details when nothing verifies a price", async () => {
  clearQuoteCache();
  await assert.rejects(
    () =>
      getVerifiedQuote("STUBFAIL", {
        exchange: "NSE",
        cache: false,
        providers: [
          stubProvider("a", { error: new Error("no quote") }),
          stubProvider("b", { quote: verifiedQuote({ quoteVerified: false, price: null }) })
        ]
      }),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.details.length, 2);
      assert.match(error.message, /No configured provider/);
      return true;
    }
  );
});

test("rejects malformed symbols before any provider is contacted", async () => {
  clearQuoteCache();
  let called = false;

  await assert.rejects(
    () =>
      getVerifiedQuote("BAD SYMBOL!", {
        providers: [stubProvider("a", { quote: verifiedQuote(), onCall: () => { called = true; } })]
      }),
    (error) => {
      assert.equal(error.statusCode, 400);
      return true;
    }
  );

  assert.equal(called, false);
});

test("caches a verified quote and serves the cached copy within the TTL", async () => {
  clearQuoteCache();
  let calls = 0;
  const providers = [
    stubProvider("a", { quote: verifiedQuote({ price: 77 }), onCall: () => { calls += 1; } })
  ];

  const first = await getVerifiedQuote("STUBCACHE", { exchange: "NSE", providers });
  const second = await getVerifiedQuote("STUBCACHE", { exchange: "NSE", providers });

  assert.equal(calls, 1);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(second.price, 77);
});

test("cache can be bypassed and respects a zero TTL", async () => {
  clearQuoteCache();
  let calls = 0;
  const providers = [
    stubProvider("a", { quote: verifiedQuote(), onCall: () => { calls += 1; } })
  ];

  await getVerifiedQuote("STUBBYPASS", { providers });
  await getVerifiedQuote("STUBBYPASS", { providers, cache: false });
  await getVerifiedQuote("STUBBYPASS", { providers, cacheTtlMs: 0 });

  assert.equal(calls, 3);
});

test("batch quotes drop failures without inventing replacements", async () => {
  clearQuoteCache();
  const providers = [
    {
      id: "mixed",
      supports: () => true,
      isConfigured: () => true,
      async fetchQuote(instrument) {
        if (instrument.symbol === "MISSING") throw new Error("no quote");
        return verifiedQuote({ price: 10, symbol: instrument.symbol });
      }
    }
  ];

  const quotes = await getVerifiedQuotes(
    [{ id: "A", symbol: "OK1", exchange: "NSE" }, { id: "B", symbol: "MISSING", exchange: "NSE" }, { id: "C", symbol: "OK2", exchange: "NSE" }],
    { providers, cache: false }
  );

  assert.deepEqual(
    quotes.map((quote) => quote.symbol),
    ["OK1", "OK2"]
  );
});

test("mapConcurrent preserves input order and honours the width", async () => {
  let active = 0;
  let peak = 0;

  const results = await mapConcurrent([5, 1, 3, 2, 4], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, value));
    active -= 1;
    return value * 2;
  });

  assert.deepEqual(results, [10, 2, 6, 4, 8]);
  assert.ok(peak <= 2, `expected at most 2 concurrent workers, saw ${peak}`);
});

test("mapConcurrent handles an empty list", async () => {
  assert.deepEqual(await mapConcurrent([], 4, async () => 1), []);
});

test("a provider quote that violates the contract is rejected in favour of the next provider", async () => {
  clearQuoteCache();

  const drifted = {
    id: "drifted",
    supports: () => true,
    isConfigured: () => true,
    async fetchQuote() {
      // Missing instrumentId/source/freshness and carries a verified flag.
      return { quoteVerified: true, price: 10, symbol: "BROKEN" };
    }
  };

  const quote = await getVerifiedQuote("CONTRACTDRIFT", {
    exchange: "NSE",
    cache: false,
    providers: [drifted, stubProvider("healthy", { quote: verifiedQuote({ price: 12, provider: "healthy" }) })]
  });

  assert.equal(quote.price, 12);
  assert.equal(quote.provider, "healthy");
  assert.equal(quote.fallbackUsed, true);
  assert.match(quote.providerErrors[0].message, /failed contract validation/i);
});

test("a single drifted provider produces an honest 503, never the malformed quote", async () => {
  clearQuoteCache();

  await assert.rejects(
    () =>
      getVerifiedQuote("CONTRACTONLY", {
        exchange: "NSE",
        cache: false,
        providers: [{
          id: "drifted",
          supports: () => true,
          isConfigured: () => true,
          async fetchQuote() {
            return { quoteVerified: true, price: 10, symbol: "BROKEN" };
          }
        }]
      }),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.match(error.details[0].message, /failed contract validation/i);
      return true;
    }
  );
});
