import test from "node:test";
import assert from "node:assert/strict";
import marketHandler from "../handlers/market.js";

function mockResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function withEnvironment(values, callback) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  return Promise.resolve(callback()).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("NSE symbols try the FMP .NS ticker before the bare ticker", async () => {
  await withEnvironment({ FMP_API_KEY: "test-key", PRIMARY_MARKET_PROVIDER: "fmp" }, async () => {
    const requested = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      requested.push(String(url));
      if (String(url).includes("/quote/SUFFIXTEST.NS")) {
        return Response.json([{ symbol: "SUFFIXTEST.NS", price: 99.5 }]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    try {
      const res = mockResponse();
      await marketHandler({ query: { symbol: "SUFFIXTEST", exchange: "NSE" } }, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.price, 99.5);
      assert.equal(requested.length, 1);
      assert.match(requested[0], /quote\/SUFFIXTEST\.NS\?/);
      assert.equal(res.body.displaySymbol, "SUFFIXTEST");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("FMP never falls back to a bare Indian ticker that could be another company", async () => {
  await withEnvironment({ FMP_API_KEY: "test-key", PRIMARY_MARKET_PROVIDER: "fmp" }, async () => {
    const requested = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      requested.push(String(url));
      if (String(url).includes("/quote/FALLBACKTEST.NS")) return Response.json([]);
      throw new Error(`Unexpected URL: ${url}`);
    };

    try {
      const res = mockResponse();
      await marketHandler({ query: { symbol: "FALLBACKTEST", exchange: "NSE" } }, res);

      assert.equal(res.statusCode, 503);
      assert.equal(requested.length, 1, "a missing .NS listing must not trigger a bare-ticker request");
      assert.match(requested[0], /FALLBACKTEST\.NS/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("a cross-currency quote for the wrong listing is rejected (TCS regression)", async () => {
  await withEnvironment({ FMP_API_KEY: "test-key", PRIMARY_MARKET_PROVIDER: "fmp" }, async () => {
    const originalFetch = globalThis.fetch;
    // The real-world bug: FMP's bare `TCS` is The Container Store on NYSE in USD.
    globalThis.fetch = async () =>
      Response.json([
        {
          symbol: "TCS",
          price: 37.45,
          currency: "USD",
          exchangeShortName: "NYSE"
        }
      ]);

    try {
      const res = mockResponse();
      await marketHandler({ query: { symbol: "TCS", exchange: "NSE" } }, res);

      assert.equal(res.statusCode, 503);
      assert.equal(res.body.price, undefined);
      assert.match(JSON.stringify(res.body.details), /cross-currency|listed on NSE/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("BSE symbols use the FMP .BO suffix", async () => {
  await withEnvironment({ FMP_API_KEY: "test-key", PRIMARY_MARKET_PROVIDER: "fmp" }, async () => {
    const originalFetch = globalThis.fetch;
    let called = "";
    globalThis.fetch = async (url) => {
      called = String(url);
      return Response.json([{ symbol: "BSETEST.BO", price: 42 }]);
    };

    try {
      const res = mockResponse();
      await marketHandler({ query: { symbol: "BSETEST", exchange: "BSE" } }, res);
      assert.equal(res.statusCode, 200);
      assert.match(called, /quote\/BSETEST\.BO\?/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("market endpoint rejects malformed symbols without calling providers", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("should not fetch");
  };

  try {
    const res = mockResponse();
    await marketHandler({ query: { symbol: "BAD SYMBOL!" } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a symbol with no exchange is queried once, without an invented venue", async () => {
  await withEnvironment({ FMP_API_KEY: "test-key", PRIMARY_MARKET_PROVIDER: "fmp" }, async () => {
    const requested = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      requested.push(String(url));
      return Response.json([{ symbol: "VENUELESS", price: 5 }]);
    };

    try {
      const res = mockResponse();
      await marketHandler({ query: { symbol: "VENUELESS" } }, res);

      assert.equal(res.statusCode, 200);
      assert.equal(requested.length, 1);
      assert.match(requested[0], /quote\/VENUELESS\?/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
