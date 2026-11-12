import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const apiDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "api"
);

test("every api route module parses and exports a handler", async () => {
  const files = (await readdir(apiDirectory)).filter((file) => file.endsWith(".js"));
  assert.ok(files.length > 0, "Expected at least one API route module.");

  for (const file of files) {
    const module = await import(pathToFileURL(path.join(apiDirectory, file)));
    assert.equal(
      typeof module.default,
      "function",
      `${file} must export a default handler function.`
    );
  }
});

test("history endpoint reports a missing provider instead of failing", async () => {
  const handler = (await import("../api/history.js")).default;
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
    assert.match(res.body.error, /provider is configured/i);
    assert.equal(res.body.candles, undefined);
  } finally {
    if (previousTwelve === undefined) delete process.env.TWELVE_DATA_API_KEY;
    else process.env.TWELVE_DATA_API_KEY = previousTwelve;
    if (previousAlpha === undefined) delete process.env.ALPHA_VANTAGE_API_KEY;
    else process.env.ALPHA_VANTAGE_API_KEY = previousAlpha;
  }
});

test("history endpoint validates symbols and intervals before contacting providers", async () => {
  const handler = (await import("../api/history.js")).default;
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
