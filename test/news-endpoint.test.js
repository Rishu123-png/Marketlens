import test from "node:test";
import assert from "node:assert/strict";
import newsHandler from "../handlers/news.js";
import providerStatusHandler from "../handlers/provider-status.js";
import { clearEvidenceCache } from "../server/news/service.js";
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

const FEED = `<?xml version="1.0"?><rss><channel>
  <item>
    <title>Reliance Industries reports quarterly results</title>
    <link>https://feed.example.com/reliance-q3</link>
    <pubDate>Mon, 02 Feb 2026 10:00:00 GMT</pubDate>
    <description>Reliance Industries reported quarterly results.</description>
  </item>
  <item>
    <title>Unrelated market headline</title>
    <link>https://feed.example.com/other</link>
    <pubDate>Mon, 02 Feb 2026 09:00:00 GMT</pubDate>
    <description>Something else entirely.</description>
  </item>
</channel></rss>`;

async function withFeed(callback) {
  const previous = {
    NEWS_RSS_FEEDS: process.env.NEWS_RSS_FEEDS,
    NEWS_API_KEY: process.env.NEWS_API_KEY,
    GNEWS_API_KEY: process.env.GNEWS_API_KEY
  };
  process.env.NEWS_RSS_FEEDS = "Test Wire|https://feed.example.com/rss.xml";
  delete process.env.NEWS_API_KEY;
  delete process.env.GNEWS_API_KEY;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("feed.example.com")) {
      return new Response(FEED, { status: 200, headers: { "content-type": "application/xml" } });
    }
    return new Response("not found", { status: 404 });
  };

  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearEvidenceCache();
    resetRateLimitsForTests();
  }
}

test("news endpoint returns sanitized, deduplicated evidence for the instrument", async () => {
  resetRateLimitsForTests();
  clearEvidenceCache();
  await withFeed(async () => {
    const res = mockResponse();
    await newsHandler({ query: { symbol: "RELIANCE", exchange: "NSE" } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.mode, "evidence");
    assert.equal(res.body.instrumentId, "IN-EQ-RELIANCE");
    assert.equal(res.body.evidence.length, 1, "only the matching headline is kept");
    assert.equal(res.body.evidence[0].sourceType, "announcement");
    assert.equal(res.body.evidence[0].metadata.untrusted, true);
    assert.ok(res.body.evidence[0].retrievedAt);
    assert.ok(res.body.sources.some((source) => source.id === "newsapi" && source.status === "not-configured"));
    assert.ok(res.body.sources.some((source) => source.id === "nse-announcements" && source.status === "not-configured"));
    assert.deepEqual(res.body.counts.rejected, 0);
  });
});

test("news endpoint rejects an invalid symbol and can skip filings", async () => {
  resetRateLimitsForTests();
  const invalid = mockResponse();
  await newsHandler({ query: { symbol: "" } }, invalid);
  assert.equal(invalid.statusCode, 400);

  clearEvidenceCache();
  await withFeed(async () => {
    const res = mockResponse();
    await newsHandler({ query: { symbol: "INFY", exchange: "NSE", filings: "false" } }, res);
    assert.equal(res.statusCode, 200);
    assert.ok(!res.body.sources.some((source) => source.id.startsWith("nse-")));
  });
});

test("provider status separates configured from verified", () => {
  const res = mockResponse();
  providerStatusHandler({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok("fmp" in res.body.market);
  assert.ok(Array.isArray(res.body.news));
  assert.ok(Array.isArray(res.body.filings));

  const nse = res.body.filings.find((entry) => entry.id === "nse-announcements");
  assert.equal(nse.status, "disabled-requires-credentials");
  assert.match(res.body.warning, /Configured only means a key exists/);
});
