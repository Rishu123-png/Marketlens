import test from "node:test";
import assert from "node:assert/strict";
import reportHandler from "../api/report.js";
import { resetRateLimitsForTests } from "../lib/server/rateLimit.js";

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
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

test("report endpoint uses a server-fetched quote instead of browser-supplied prices", async () => {
  resetRateLimitsForTests();
  await withEnvironment({
    FMP_API_KEY: "test-fmp-key",
    GROQ_API_KEY: "test-groq-key",
    PRIMARY_MARKET_PROVIDER: "fmp"
  }, async () => {
    let prompt = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).includes("financialmodelingprep.com")) {
        return Response.json([{
          symbol: "ARENAQUOTE",
          price: 123.45,
          change: 2.5,
          changesPercentage: 2.07,
          open: 120,
          previousClose: 120.95,
          dayHigh: 125,
          dayLow: 119,
          volume: 9876
        }]);
      }
      if (String(url).includes("api.groq.com")) {
        const body = JSON.parse(options.body);
        prompt = body.messages[1].content;
        return Response.json({
          choices: [{ message: { content: JSON.stringify({ headline: "Test" }) } }]
        });
      }
      throw new Error(`Unexpected provider URL: ${url}`);
    };

    try {
      const req = {
        method: "POST",
        headers: { "x-forwarded-for": "report-test-1" },
        body: {
          stock: { symbol: "ARENAQUOTE", exchange: "NSE" },
          metrics: { price: 0.01, source: "forged" }
        }
      };
      const res = mockResponse();
      await reportHandler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.verifiedMetrics.price, 123.45);
      assert.equal(res.body.verifiedMetrics.source, "Financial Modeling Prep");
      assert.match(prompt, /123\.45/);
      assert.doesNotMatch(prompt, /0\.01/);
      assert.doesNotMatch(prompt, /forged/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("report endpoint refuses to call AI when no provider quote can be verified", async () => {
  resetRateLimitsForTests();
  await withEnvironment({
    FMP_API_KEY: "test-fmp-key",
    GROQ_API_KEY: "test-groq-key",
    PRIMARY_MARKET_PROVIDER: "fmp"
  }, async () => {
    const originalFetch = globalThis.fetch;
    let groqCalled = false;
    globalThis.fetch = async (url) => {
      if (String(url).includes("financialmodelingprep.com")) return Response.json([]);
      if (String(url).includes("api.groq.com")) groqCalled = true;
      throw new Error("Unexpected provider call");
    };

    try {
      const res = mockResponse();
      await reportHandler({
        method: "POST",
        headers: { "x-forwarded-for": "report-test-2" },
        body: { stock: { symbol: "NOQUOTE" }, metrics: { price: 1000 } }
      }, res);
      assert.equal(res.statusCode, 503);
      assert.equal(groqCalled, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("report endpoint validates symbols before contacting providers", async () => {
  resetRateLimitsForTests();
  let called = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("fetch should not be called");
  };
  try {
    const res = mockResponse();
    await reportHandler({
      method: "POST",
      headers: { "x-forwarded-for": "report-test-3" },
      body: { stock: { symbol: "<script>" } }
    }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
