import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  apiRoutes,
  dispatchApiRequest,
  matchApiRoute,
  normalizeApiPath,
  pathnameFromRequest
} from "../../server/http/router.js";
import apiFunction from "../../api/index.js";

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    json(body) {
      this.body = body;
      this.headersSent = true;
      return this;
    }
  };
}

test("normalizeApiPath accepts real routes and rejects traversal", () => {
  assert.equal(normalizeApiPath("/api/news"), "/api/news");
  assert.equal(normalizeApiPath("/api/news/"), "/api/news");
  assert.equal(normalizeApiPath("/api/jobs/research_ab12cd34"), "/api/jobs/research_ab12cd34");
  assert.equal(normalizeApiPath("/api"), "/api");
  assert.equal(normalizeApiPath("/api/news?symbol=X"), "/api/news");

  for (const bad of ["/api/../server", "/api/news/../jobs", "/api//news", "/api/news%2F..%2Fjobs", "news", "/other/news", ""]) {
    assert.throws(() => normalizeApiPath(bad), /Invalid API path/, `expected ${bad} to be rejected`);
  }
  assert.throws(() => normalizeApiPath(`/api/${"a".repeat(300)}`), /Invalid API path/);
});

test("pathnameFromRequest rebuilds the path after the Vercel rewrite", () => {
  assert.equal(pathnameFromRequest({ query: { __path: "news" }, url: "/api?__path=news" }), "/api/news");
  assert.equal(
    pathnameFromRequest({ query: { __path: "jobs/research_ab12cd34" }, url: "/api?__path=jobs/research_ab12cd34" }),
    "/api/jobs/research_ab12cd34"
  );
  // Wildcard captures can arrive as arrays.
  assert.equal(pathnameFromRequest({ query: { __path: ["jobs", "research_ab12cd34"] }, url: "/api" }), "/api/jobs/research_ab12cd34");
  // Direct call without a rewrite (local server / /api itself).
  assert.equal(pathnameFromRequest({ query: {}, url: "/api/health" }), "/api/health");
  assert.equal(pathnameFromRequest({ query: {}, url: "/api" }), "/api");
  assert.throws(() => pathnameFromRequest({ query: { __path: "../server" }, url: "/api" }), /Invalid API path/);
});

test("route table matches static routes before parameterised ones", () => {
  const jobs = matchApiRoute("/api/jobs");
  assert.equal(jobs.definition, "jobs");
  assert.deepEqual(jobs.params, {});

  const detail = matchApiRoute("/api/jobs/research_ab12cd34");
  assert.equal(detail.definition, "jobs/:jobId");
  assert.deepEqual(detail.params, { jobId: "research_ab12cd34" });

  assert.equal(matchApiRoute("/api/nope"), null);
  assert.equal(matchApiRoute("/api/../secret"), null);

  const routes = apiRoutes();
  assert.ok(routes.some((route) => route.path === "/api/coverage"));
  assert.ok(routes.some((route) => route.path === "/api/jobs/{jobId}"));
  assert.equal(new Set(routes.map((route) => route.path)).size, routes.length, "route paths must be unique");
});

test("dispatch answers unknown routes with JSON 404 and delegates known ones", async () => {
  const missing = mockResponse();
  await dispatchApiRequest({ query: {} }, missing, { pathname: "/api/does-not-exist", query: {} });
  assert.equal(missing.statusCode, 404);
  assert.match(missing.body.error, /not found/i);

  const health = mockResponse();
  await dispatchApiRequest({ method: "GET", query: {} }, health, { pathname: "/api/health", query: {} });
  assert.equal(health.statusCode, 200);
  assert.equal(health.body.service, "marketlens-api");

  // __path must never leak into handler query objects.
  const cleaned = mockResponse();
  const req = { method: "GET", query: {} };
  await dispatchApiRequest(req, cleaned, { pathname: "/api/coverage", query: { __path: "coverage" } });
  assert.equal(cleaned.statusCode, 200);
  assert.equal(Object.hasOwn(req.query, "__path"), false);
});

test("the deployed function routes rewritten requests and rejects bad paths", async () => {
  const ok = mockResponse();
  await apiFunction({ method: "GET", query: { __path: "health" }, url: "/api?__path=health" }, ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.ok, true);

  const unknown = mockResponse();
  await apiFunction({ method: "GET", query: { __path: "nope" }, url: "/api?__path=nope" }, unknown);
  assert.equal(unknown.statusCode, 404);

  const invalid = mockResponse();
  await apiFunction({ method: "GET", query: { __path: "../server" }, url: "/api" }, invalid);
  assert.equal(invalid.statusCode, 400);
});

test("vercel.json stays inside the Hobby plan limits", () => {
  const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));

  // Hobby: max 12 functions, and maxDuration must be between 1 and 60.
  const functions = Object.entries(config.functions ?? {});
  assert.deepEqual(functions.map(([file]) => file), ["api/index.js"]);
  for (const [file, settings] of functions) {
    assert.ok(settings.maxDuration >= 1 && settings.maxDuration <= 60, `${file} maxDuration must be ≤ 60`);
  }

  // A plain api/[...path].js is single-segment outside Next.js, so /api/* must be
  // rewritten into the single function with the original path captured.
  const rewrite = (config.rewrites ?? []).find((entry) => entry.source === "/api/:path*");
  assert.ok(rewrite, "expected the /api/:path* rewrite");
  assert.match(rewrite.destination, /__path=:path\*/);
});
