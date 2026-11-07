import test from "node:test";
import assert from "node:assert/strict";
import { rateLimit, resetRateLimitsForTests } from "../lib/server/rateLimit.js";

test("fixed-window limiter allows the configured number, then blocks", async () => {
  resetRateLimitsForTests();
  const req = { headers: { "x-forwarded-for": "limiter-test" } };
  const options = { name: "test", limit: 2, windowMs: 60_000 };
  assert.equal((await rateLimit(req, options)).allowed, true);
  assert.equal((await rateLimit(req, options)).allowed, true);
  const blocked = await rateLimit(req, options);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
});
