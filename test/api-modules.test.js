import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDirectory = path.join(root, "api");
const handlersDirectory = path.join(root, "handlers");

async function listHandlers(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listHandlers(full)));
    else if (entry.name.endsWith(".js")) files.push(full);
  }
  return files;
}

test("Vercel sees exactly one function; handlers stay outside api/", async () => {
  // Vercel Hobby allows 12 functions per deployment and every file under api/
  // counts. This assertion is the guard that keeps a deploy from silently
  // failing after a green build.
  const apiEntries = await readdir(apiDirectory);
  assert.deepEqual(apiEntries.sort(), ["index.js"], "api/ must contain only the single router function");

  const handlers = await listHandlers(handlersDirectory);
  assert.ok(handlers.length >= 20, `expected the route handlers to live in handlers/, found ${handlers.length}`);
});

test("every handler module exports a function and is reachable through the router", async () => {
  const handlers = await listHandlers(handlersDirectory);
  const { apiRoutes, matchApiRoute } = await import("../server/http/router.js");
  const routed = apiRoutes();

  for (const file of handlers) {
    const module = await import(pathToFileURL(file));
    assert.equal(typeof module.default, "function", `${path.relative(root, file)} must export a default handler`);
  }

  assert.equal(routed.length, handlers.length, "every handler must have exactly one route");
  for (const route of routed) {
    const path = route.path.replace("{jobId}", "research_abcdef12");
    const match = matchApiRoute(path);
    assert.ok(match, `${path} must resolve`);
    assert.equal(typeof match.handler, "function");
  }
});

test("history endpoint reports a missing provider instead of failing", async () => {
  const handler = (await import("../handlers/history.js")).default;
  const previousTwelve = process.env.TWELVE_DATA_API_KEY;
  const previousAlpha = process.env.ALPHA_VANTAGE_API_KEY;
  delete process.env.TWELVE_DATA_API_KEY;
  delete process.env.ALPHA_VANTAGE_API_KEY;

  const res = {
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

  try {
    await handler({ query: { symbol: "RELIANCE" } }, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /no configured provider/i);
    assert.equal(res.body.candles, undefined);
  } finally {
    if (previousTwelve === undefined) delete process.env.TWELVE_DATA_API_KEY;
    else process.env.TWELVE_DATA_API_KEY = previousTwelve;
    if (previousAlpha === undefined) delete process.env.ALPHA_VANTAGE_API_KEY;
    else process.env.ALPHA_VANTAGE_API_KEY = previousAlpha;
  }
});

test("history endpoint validates symbols and intervals before contacting providers", async () => {
  const handler = (await import("../handlers/history.js")).default;
  const made = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    made.push(String(url));
    throw new Error("fetch should not be called");
  };

  const res = {
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

  try {
    const first = Object.create(res);
    await handler({ query: { symbol: "<script>" } }, first);
    assert.equal(first.statusCode, 400);

    const second = Object.create(res);
    await handler({ query: { symbol: "RELIANCE", interval: "2day" } }, second);
    assert.equal(second.statusCode, 400);

    assert.equal(made.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
