import test from "node:test";
import assert from "node:assert/strict";
import { signQstashPayload, verifyQstashSignature } from "../../server/jobs/qstashSignature.js";
import { ownerFromRequest, ownerHash, ownerMatches } from "../../server/jobs/access.js";

const key = "signing-key-for-tests";

test("a valid QStash signature over the exact body verifies", () => {
  const body = JSON.stringify({ jobId: "research_abcdef12" });
  const signature = signQstashPayload({ key, body });
  const verdict = verifyQstashSignature({ signature, rawBody: body, keys: [key] });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.status, "verified");
});

test("a tampered body, wrong key or expired token is rejected", () => {
  const body = JSON.stringify({ jobId: "research_abcdef12" });
  const signature = signQstashPayload({ key, body });

  assert.equal(verifyQstashSignature({ signature, rawBody: `${body} `, keys: [key] }).status, "body-mismatch");
  assert.equal(verifyQstashSignature({ signature, rawBody: body, keys: ["other-key"] }).status, "invalid");

  const expired = signQstashPayload({ key, body, exp: Math.floor(Date.now() / 1000) - 10 });
  assert.equal(verifyQstashSignature({ signature: expired, rawBody: body, keys: [key] }).status, "expired");
});

test("a body-bound signature fails closed when the raw body is unavailable", () => {
  const signature = signQstashPayload({ key, body: "{}" });
  const verdict = verifyQstashSignature({ signature, rawBody: null, keys: [key] });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, "body-unavailable");
});

test("no configured signing key is reported rather than treated as valid", () => {
  const verdict = verifyQstashSignature({ signature: "a.b.c", keys: [] });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, "not-configured");
});

test("job owner tokens are hashed and compared without accepting a different owner", () => {
  const owner = "a".repeat(48);
  const hash = ownerHash(owner);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(ownerMatches(hash, owner), true);
  assert.equal(ownerMatches(hash, "b".repeat(48)), false);
  assert.equal(ownerMatches(null, null), true, "legacy jobs without an owner stay readable");
  assert.equal(ownerMatches(hash, null), false);
  assert.equal(ownerFromRequest({ headers: { "x-owner-id": owner } }), owner);
  assert.equal(ownerFromRequest({ headers: { "x-owner-id": "short" } }), null);
});
