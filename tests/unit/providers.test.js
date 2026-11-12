import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCandle, normalizeQuote } from "../../server/market-data/normalize.js";
import { getInstrument, instrumentFromSymbol } from "../../shared/instruments/catalog.js";
import { twelveProvider } from "../../server/market-data/providers/twelve.js";
import { alphaProvider } from "../../server/market-data/providers/alpha.js";
import { fmpProvider } from "../../server/market-data/providers/fmp.js";

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

test("normalization maps provider naming variants onto one quote shape", () => {
  const fromTwelve = normalizeQuote({
    item: {
      symbol: "RELIANCE",
      close: "1,450.50",
      change: "12.30",
      percent_change: "0.86",
      open: "1440",
      previous_close: "1438.20",
      high: "1455",
      low: "1436",
      volume: "1234567"
    },
    instrument: reliance,
    source: "Twelve Data",
    provider: "twelve"
  });

  assert.equal(fromTwelve.price, 1450.5);
  assert.equal(fromTwelve.change, 12.3);
  assert.equal(fromTwelve.changePercent, 0.86);
  assert.equal(fromTwelve.previousClose, 1438.2);
  assert.equal(fromTwelve.dayHigh, 1455);
  assert.equal(fromTwelve.volume, 1234567);
  assert.equal(fromTwelve.instrumentId, "IN-EQ-RELIANCE");
  assert.equal(fromTwelve.currency, "INR");
  assert.equal(fromTwelve.quoteVerified, true);
  assert.equal(fromTwelve.freshness, "verified");

  const fromAlpha = normalizeQuote({
    item: {
      "05. price": "1450.5000",
      "09. change": "12.3000",
      "10. change percent": "0.8560%",
      "08. previous close": "1438.2000"
    },
    instrument: reliance,
    source: "Alpha Vantage",
    provider: "alpha"
  });

  assert.equal(fromAlpha.price, 1450.5);
  assert.equal(fromAlpha.changePercent, 0.856);
  assert.equal(fromAlpha.previousClose, 1438.2);
});

test("a quote without a usable price is not marked verified", () => {
  const quote = normalizeQuote({
    item: { price: null },
    instrument: reliance,
    source: "Test",
    provider: "test"
  });

  assert.equal(quote.price, null);
  assert.equal(quote.quoteVerified, false);
});

test("provider timestamps are normalized to ISO or left null", () => {
  const epoch = normalizeQuote({
    item: { price: 10, timestamp: 1_700_000_000 },
    instrument: reliance,
    source: "Test",
    provider: "test"
  });
  assert.equal(epoch.providerTimestamp, new Date(1_700_000_000_000).toISOString());

  const missing = normalizeQuote({
    item: { price: 10 },
    instrument: reliance,
    source: "Test",
    provider: "test"
  });
  assert.equal(missing.providerTimestamp, null);
});

test("candle normalization rejects rows with gaps or non-numeric prices", () => {
  const good = normalizeCandle(
    { datetime: "2026-11-11 15:30:00", open: "10", high: "12", low: "9", close: "11", volume: "500" },
    "Test"
  );
  assert.deepEqual(good, {
    time: "2026-11-11 15:30:00",
    open: 10,
    high: 12,
    low: 9,
    close: 11,
    volume: 500,
    source: "Test"
  });

  assert.equal(normalizeCandle({ date: "2026-11-11", open: "10", high: null, low: "9", close: "11" }, "Test"), null);
  assert.equal(normalizeCandle({ open: "10", high: "12", low: "9", close: "11" }, "Test"), null);
});

test("twelve adapter sends the exchange-prefixed ticker and normalizes the response", async () => {
  await withEnv({ TWELVE_DATA_API_KEY: "test-key" }, async () => {
    const requested = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      requested.push(String(url));
      return Response.json({
        symbol: "NSE:RELIANCE",
        name: "Reliance Industries",
        close: "1450.5",
        change: "12.3",
        percent_change: "0.86",
        high: "1455",
        low: "1436",
        open: "1440",
        previous_close: "1438.2",
        volume: "1234567"
      });
    };

    try {
      const quote = await twelveProvider.fetchQuote(reliance);
      assert.equal(quote.price, 1450.5);
      assert.equal(quote.provider, "twelve");
      assert.equal(quote.symbol, "RELIANCE");
      assert.match(requested[0], /symbol=NSE%3ARELIANCE/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("twelve adapter surfaces provider errors instead of returning a price", async () => {
  await withEnv({ TWELVE_DATA_API_KEY: "test-key" }, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      Response.json({ code: 429, message: "API limit reached", status: "error" });

    try {
      await assert.rejects(() => twelveProvider.fetchQuote(reliance), /API limit reached/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("alpha adapter falls back to the .BSE listing for Indian equities", async () => {
  await withEnv({ ALPHA_VANTAGE_API_KEY: "test-key" }, async () => {
    const requested = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      requested.push(String(url));
      if (String(url).includes("RELIANCE.BSE")) {
        return Response.json({ "Global Quote": { "05. price": "1451.00" } });
      }
      return Response.json({});
    };

    try {
      const quote = await alphaProvider.fetchQuote(reliance);
      assert.equal(quote.price, 1451);
      assert.equal(requested.length, 2);
      assert.match(requested[1], /RELIANCE\.BSE/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("alpha candles fall back to the BSE listing for an NSE instrument", async () => {
  await withEnv({ ALPHA_VANTAGE_API_KEY: "test-key" }, async () => {
    const requested = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      requested.push(String(url));
      if (String(url).includes("symbol=RELIANCE.NSE")) {
        return Response.json({ "Error Message": "Invalid API call." });
      }
      return Response.json({
        "Meta Data": { "2. Symbol": "RELIANCE.BSE" },
        "Time Series (Daily)": {
          "2026-11-11": { "1. open": "10", "2. high": "12", "3. low": "9", "4. close": "11", "5. volume": "100" },
          "2026-11-10": { "1. open": "9", "2. high": "11", "3. low": "8", "4. close": "10", "5. volume": "90" }
        }
      });
    };

    try {
      const series = await alphaProvider.fetchCandles(reliance, { interval: "1day", limit: 2 });
      assert.equal(series.length, 2);
      assert.ok(series[0].time < series[1].time);
      assert.equal(requested.length, 2);
      assert.match(requested[1], /RELIANCE\.BSE/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("alpha quota notices stop before trying the other exchange suffix", async () => {
  await withEnv({ ALPHA_VANTAGE_API_KEY: "test-key" }, async () => {
    const requested = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      requested.push(String(url));
      return Response.json({ Note: "Our standard API rate limit is 25 requests per day." });
    };

    try {
      await assert.rejects(() => alphaProvider.fetchQuote(reliance), /rate limit/i);
      assert.equal(requested.length, 1, "a daily quota response must not trigger a second call");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("fmp adapter reports a missing key instead of calling the provider", async () => {
  await withEnv({ FMP_API_KEY: "" }, async () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return Response.json([]);
    };

    try {
      await assert.rejects(() => fmpProvider.fetchQuote(reliance), /not configured/);
      assert.equal(called, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("providers skip instruments they cannot map", () => {
  const unknownVenue = instrumentFromSymbol("SOMETHING", "LSE");
  // A US-style derived instrument is still mappable, so only indices remain
  // genuinely unmappable for Twelve Data.
  assert.equal(twelveProvider.supports(unknownVenue), true);
  assert.equal(twelveProvider.supports(getInstrument("IN-IDX-NIFTY50")), false);
  assert.equal(fmpProvider.supports(getInstrument("IN-IDX-NIFTY50")), true);
});
