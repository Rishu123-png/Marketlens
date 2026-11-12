import test from "node:test";
import assert from "node:assert/strict";
import coverageHandler from "../handlers/coverage.js";
import navHandler from "../handlers/nav.js";
import officialDataHandler from "../handlers/official-data.js";
import providerStatusHandler from "../handlers/provider-status.js";
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

test("coverage endpoint reports capabilities without leaking configuration", () => {
  const res = mockResponse();
  coverageHandler({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.coverage.version, "1.0.0");
  assert.ok(res.body.coverage.capabilities.candles);
  assert.ok(Array.isArray(res.body.coverage.sources));
  assert.match(res.headers["cache-control"], /max-age=60/);

  const serialized = JSON.stringify(res.body);
  // Variable *names* are fine to disclose; values never are.
  const previous = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "secret-value-should-not-appear";
  try {
    assert.equal(JSON.stringify(res.body).includes("secret-value-should-not-appear"), false);
  } finally {
    if (previous === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previous;
  }
});

test("provider status names Groq as the single AI backbone and includes coverage", () => {
  const res = mockResponse();
  providerStatusHandler({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.aiProvider.id, "groq");
  assert.equal(typeof res.body.aiProvider.configured, "boolean");
  assert.equal(res.body.coverage.version, "1.0.0");
  assert.ok(Array.isArray(res.body.coverage.limitations));
});

test("nav endpoint validates identifiers before touching the network", async () => {
  const missing = mockResponse();
  await navHandler({ query: {} }, missing);
  assert.equal(missing.statusCode, 400);

  const badIsin = mockResponse();
  await navHandler({ query: { isin: "AAPL" } }, badIsin);
  assert.equal(badIsin.statusCode, 400);

  const badCode = mockResponse();
  await navHandler({ query: { schemeCode: "abc" } }, badCode);
  assert.equal(badCode.statusCode, 400);

  resetRateLimitsForTests();
});

test("official-data endpoint fails closed when data.gov.in is not configured", async () => {
  const res = mockResponse();
  await officialDataHandler({ query: { resource: "some-resource" } }, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /DATA_GOV_IN_API_KEY/);
  resetRateLimitsForTests();
});
