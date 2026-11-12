import test from "node:test";
import assert from "node:assert/strict";

import { createTtlCache } from "../../server/evidence/cache.js";
import { activeFeeds, feedStatus, parseFeedConfig, rssPollingEnabled } from "../../server/news/feeds.js";
import { sourceStatuses } from "../../server/evidence/registry.js";
import { buildCoverage, coverageSummary } from "../../server/evidence/coverage.js";
import { createSecClient, isUsInstrument } from "../../server/evidence/secEdgar.js";
import { AMFI_URLS, createAmfiNavClient, parseNavAll } from "../../server/evidence/amfiNav.js";
import { createDataGovClient } from "../../server/evidence/dataGovIn.js";

test("ttl cache serves hits, expires and never caches failures", async () => {
  let clock = 1_000;
  const cache = createTtlCache({ now: () => clock });
  let loads = 0;
  const loader = async () => {
    loads += 1;
    return { n: loads };
  };

  const first = await cache.getOrLoad("k", 100, loader);
  const second = await cache.getOrLoad("k", 100, loader);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(loads, 1);
  assert.deepEqual(second.value, { n: 1 });

  clock += 150;
  const third = await cache.getOrLoad("k", 100, loader);
  assert.equal(third.cached, false);
  assert.equal(loads, 2);

  await assert.rejects(() =>
    cache.getOrLoad("bad", 1_000, async () => {
      throw new Error("upstream down");
    })
  );
  assert.equal(cache.get("bad"), null);
  assert.equal(cache.stats().failures, 1);
});

test("official feeds are documented, keyed by publisher, and env-configurable", () => {
  const statuses = feedStatus({});
  const rbi = statuses.find((feed) => feed.id === "rbi-press-releases");
  assert.equal(rbi.enabled, true);
  assert.equal(rbi.documented, true);
  assert.equal(rbi.liveVerified, false);
  assert.equal(rbi.status, "enabled-unverified-live");

  const nse = statuses.find((feed) => feed.id === "nse-announcements-rss");
  assert.equal(nse.enabled, false);
  assert.equal(nse.status, "disabled-terms-risk");

  const bse = statuses.find((feed) => feed.id === "bse-announcements");
  assert.equal(bse.enabled, false);
  assert.match(bse.status, /requires-BSE_ANNOUNCEMENTS_RSS/);

  assert.equal(rssPollingEnabled({ NEWS_RSS_ENABLED: "off" }), false);
  assert.deepEqual(activeFeeds({ NEWS_RSS_ENABLED: "off" }), []);

  const withBse = activeFeeds({ BSE_ANNOUNCEMENTS_RSS: "https://example.com/bse.xml" });
  assert.ok(withBse.some((feed) => feed.id === "bse-announcements" && feed.url === "https://example.com/bse.xml"));

  const custom = parseFeedConfig("Desk Wire|https://example.com/wire.xml");
  assert.equal(custom[0].publisher, "Desk Wire");
  assert.equal(custom[0].verified, true);
});

test("source registry marks NSE scraping prohibited and official feeds available", () => {
  const statuses = sourceStatuses({});
  const nse = statuses.find((source) => source.id === "nse-website");
  assert.equal(nse.status, "prohibited");
  assert.equal(nse.official, false);

  const sebi = statuses.find((source) => source.id === "sebi-all");
  assert.equal(sebi.status, "available");
  assert.equal(sebi.verification, "documented-official");

  const sec = statuses.find((source) => source.id === "sec-edgar");
  assert.equal(sec.status, "unavailable");
  assert.equal(sec.requires, "SEC_USER_AGENT");

  const amfi = statuses.find((source) => source.id === "amfi-nav");
  assert.equal(amfi.status, "available");
  assert.equal(amfi.delayed, true);

  const secConfigured = sourceStatuses({ SEC_USER_AGENT: "MarketLens/1.0 (ops@example.com)" }).find(
    (source) => source.id === "sec-edgar"
  );
  assert.equal(secConfigured.status, "available");
});

test("coverage reports honest capability states without credentials", () => {
  const coverage = buildCoverage({
    env: {},
    cache: null,
    health: {},
    now: () => new Date("2026-01-01T00:00:00.000Z")
  });

  assert.equal(coverage.degraded, true);
  assert.equal(coverage.capabilities.news.status, "available");
  assert.equal(coverage.capabilities.news.liveVerification, "unverified");
  assert.equal(coverage.capabilities.candles.status, "unavailable");
  assert.equal(coverage.capabilities.nav.status, "available");
  assert.equal(coverage.capabilities.nav.delayed, true);
  assert.equal(coverage.capabilities.filings.status, "unavailable");
  assert.ok(coverage.limitations.some((line) => /Historical candles unavailable/.test(line)));

  const summary = coverageSummary(coverage);
  assert.equal(summary.degraded, true);
  assert.deepEqual(Object.keys(summary.capabilities).sort(), [
    "candles",
    "filings",
    "macro",
    "nav",
    "news",
    "quotes"
  ]);
  assert.ok(summary.limitations.length <= 8);

  const keyed = buildCoverage({
    env: { TWELVE_DATA_API_KEY: "k", GROQ_API_KEY: "g" },
    cache: null,
    health: {}
  });
  assert.equal(keyed.capabilities.candles.status, "degraded");

  const disabled = buildCoverage({ env: { NEWS_RSS_ENABLED: "off" }, cache: null, health: {} });
  assert.equal(disabled.capabilities.news.status, "unavailable");
});

test("coverage downgrades configured sources that are failing at runtime", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const failing = buildCoverage({
    env: {},
    cache: null,
    now: () => now,
    health: {
      "rbi-press-releases": {
        lastSuccessAt: null,
        lastFailureAt: now.toISOString(),
        lastError: "fetch failed"
      },
      "rbi-notifications": {
        lastSuccessAt: null,
        lastFailureAt: now.toISOString(),
        lastError: "fetch failed"
      },
      "rbi-speeches": {
        lastSuccessAt: null,
        lastFailureAt: now.toISOString(),
        lastError: "fetch failed"
      },
      "sebi-all": {
        lastSuccessAt: null,
        lastFailureAt: now.toISOString(),
        lastError: "fetch failed"
      },
      "pib-economy": {
        lastSuccessAt: null,
        lastFailureAt: now.toISOString(),
        lastError: "fetch failed"
      }
    }
  });

  const news = failing.capabilities.news;
  assert.equal(news.configuredStatus, "available");
  assert.equal(news.status, "degraded");
  assert.equal(news.runtime.state, "failing");
  assert.equal(news.runtime.lastError, "fetch failed");
  assert.match(news.reason, /failing at runtime/);
  assert.ok(failing.limitations.some((line) => /News & regulatory context degraded/.test(line)));

  const recovered = buildCoverage({
    env: {},
    cache: null,
    now: () => now,
    health: {
      "rbi-press-releases": {
        lastSuccessAt: now.toISOString(),
        lastFailureAt: "2025-12-31T00:00:00.000Z",
        lastError: null
      },
      "rbi-notifications": {
        lastSuccessAt: null,
        lastFailureAt: now.toISOString(),
        lastError: "timeout"
      }
    }
  });
  assert.equal(recovered.capabilities.news.runtime.state, "partial-failure");
  assert.equal(recovered.capabilities.news.status, "available");
});

test("source health tracks success, failure and recovery", async () => {
  const { recordSourceOutcome, sourceHealth, isFailing, resetSourceHealthForTests } = await import(
    "../../server/evidence/health.js"
  );
  resetSourceHealthForTests();

  recordSourceOutcome("demo", { ok: false, error: "boom", at: new Date("2026-01-01T00:00:00Z") });
  assert.equal(isFailing(sourceHealth("demo")), true);
  assert.equal(sourceHealth("demo").lastError, "boom");

  recordSourceOutcome("demo", { ok: true, at: new Date("2026-01-01T00:01:00Z") });
  assert.equal(isFailing(sourceHealth("demo")), false);
  assert.equal(sourceHealth("demo").consecutiveFailures, 0);
  assert.equal(sourceHealth("missing"), null);

  resetSourceHealthForTests();
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    }
  };
}

function secFetchStub(requests = []) {
  return async (url) => {
    requests.push(String(url));
    if (String(url).includes("company_tickers.json")) {
      return jsonResponse({ "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } });
    }
    if (String(url).includes("submissions")) {
      return jsonResponse({
        name: "Apple Inc.",
        filings: {
          recent: {
            form: ["10-K", "8-K", "10-Q"],
            filingDate: ["2026-01-05", "2025-12-20", "2019-01-01"],
            accessionNumber: ["0000320193-26-000001", "0000320193-25-000099", "0000320193-19-000001"],
            primaryDocument: ["aapl-20260105.htm", "aapl-8k.htm", "old.htm"],
            primaryDocDescription: ["Annual report", "Current report", "Quarterly report"],
            items: ["", "2.02", ""],
            reportDate: ["2025-12-31", "2025-12-20", "2018-12-31"]
          }
        }
      });
    }
    return jsonResponse({}, 404);
  };
}

test("gatherEvidence states configured-but-failing sources instead of pretending none exist", async () => {
  const { gatherEvidence, clearEvidenceCache } = await import("../../server/news/service.js");
  clearEvidenceCache();

  const data = await gatherEvidence({
    symbol: "RELIANCE",
    exchange: "NSE",
    cache: false,
    filingProviders: [],
    providers: [
      {
        id: "stub-wire",
        isConfigured: () => true,
        async search() {
          throw new Error("wire is down");
        }
      }
    ]
  });

  assert.equal(data.items.length, 0);
  assert.equal(data.sources[0].status, "failed");
  assert.match(data.sources[0].reason, /wire is down/);
  assert.ok(
    data.limitations.some((line) => /configured but none returned evidence/.test(line)),
    "a failing configured source must not be reported as unconfigured"
  );
  clearEvidenceCache();
});

test("SEC EDGAR adapter fails closed without a contact User-Agent", async () => {
  const client = createSecClient({ userAgent: undefined, fetchImpl: async () => jsonResponse({}) });
  assert.equal(client.isConfigured(), false);
  await assert.rejects(() => client.cikForTicker("AAPL"), /SEC_USER_AGENT/);
  assert.equal(isUsInstrument({ exchange: "NASDAQ" }), true);
  assert.equal(isUsInstrument({ exchange: "NSE" }), false);
});

test("SEC EDGAR adapter normalizes official filings as evidence", async () => {
  const requests = [];
  const cache = createTtlCache();
  const client = createSecClient({
    userAgent: "MarketLens/1.0 (ops@example.com)",
    fetchImpl: secFetchStub(requests),
    cache,
    minIntervalMs: 0
  });

  assert.equal(client.isConfigured(), true);

  const { items, company, cik } = await client.filingsForTicker("aapl", { limit: 5, sinceDays: 400 });
  assert.equal(cik, 320193);
  assert.equal(company, "Apple Inc.");
  assert.equal(items.length, 2, "old filings outside the window are excluded");
  assert.equal(items[0].title, "10-K — Apple Inc.");
  assert.equal(items[0].publisher, "SEC EDGAR");
  assert.equal(items[0].sourceType, "filing");
  assert.equal(items[0].verification, "verified");
  assert.equal(items[0].publishedAt, "2026-01-05T00:00:00.000Z");
  assert.match(items[0].url, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/320193\/000032019326000001\/aapl-20260105\.htm$/);
  assert.equal(items[0].metadata.form, "10-K");

  // Second identical call is served from cache: the ticker map and submissions
  // were each fetched once.
  await client.filingsForTicker("AAPL", { limit: 5, sinceDays: 400 });
  assert.equal(requests.filter((url) => url.includes("company_tickers")).length, 1);
  assert.equal(requests.filter((url) => url.includes("submissions")).length, 1);
  assert.equal(cache.stats().hits >= 2, true);

  await assert.rejects(() => client.filingsForTicker("NOPE"), /No SEC CIK/);
});

test("AMFI NAV parser handles sections, ISINs and malformed rows", () => {
  const text = [
    "Open Ended Schemes(Equity Scheme - Large Cap Fund)",
    "120503;INF209K01AA9;INF209K01AB7;Aditya Birla Sun Life Frontline Equity Fund-Growth;412.3456;05-Nov-2026",
    "garbage line without pipes",
    "120504;;;Broken Row;not-a-number;05-Nov-2026",
    "",
    "Open Ended Schemes(Other Scheme - Gold ETF)",
    "140088;INF204KB16P3;;Nippon India ETF Gold BeES;78.9123;05-Nov-2026"
  ].join("\n");

  const parsed = parseNavAll(text);
  assert.equal(parsed.count, 2);
  assert.equal(parsed.asOf, "05-Nov-2026");
  assert.equal(parsed.byIsin.get("INF204KB16P3").schemeCode, "140088");
  assert.equal(parsed.byCode.get("120503").category, "Open Ended Schemes(Equity Scheme - Large Cap Fund)");
  assert.equal(parsed.schemes[0].nav, 412.3456);
});

test("AMFI client falls back across documented URLs and reports not-found", async () => {
  const requested = [];
  const navFile = "140088;INF204KB16P3;;Nippon India ETF Gold BeES;78.9123;05-Nov-2026";
  const fetchImpl = async (url) => {
    requested.push(String(url));
    if (String(url) === AMFI_URLS[0]) return { ok: false, status: 404, async text() { return ""; } };
    return { ok: true, status: 200, async text() { return navFile; } };
  };

  const cache = createTtlCache();
  const client = createAmfiNavClient({ fetchImpl, cache });

  const found = await client.lookup({ isin: "INF204KB16P3" });
  assert.equal(found.status, "available");
  assert.equal(found.scheme.name, "Nippon India ETF Gold BeES");
  assert.equal(found.delayed, true);
  assert.match(found.note, /Not a live price/);
  assert.equal(requested[0], AMFI_URLS[0]);
  assert.equal(requested[1], AMFI_URLS[1]);

  const byCode = await client.lookup({ schemeCode: "140088" });
  assert.equal(byCode.status, "available");
  assert.equal(requested.length, 2, "second lookup is cached");

  const missing = await client.lookup({ isin: "INF000000000" });
  assert.equal(missing.status, "not-found");

  await assert.rejects(() => client.lookup({}), /valid ISIN/);
});

test("AMFI client fails closed when every URL is unavailable", async () => {
  const client = createAmfiNavClient({
    cache: createTtlCache(),
    fetchImpl: async () => {
      throw new Error("network down");
    }
  });
  await assert.rejects(() => client.lookup({ schemeCode: "140088" }), /AMFI NAV file unavailable/);

  const { sourceHealth } = await import("../../server/evidence/health.js");
  assert.equal(sourceHealth("amfi-nav").lastError !== null, true);
});

test("data.gov.in adapter is opt-in, validates ids and caches responses", async () => {
  const withoutKey = createDataGovClient({ apiKey: undefined });
  assert.equal(withoutKey.isConfigured(), false);
  await assert.rejects(() => withoutKey.fetchResource("abc"), /DATA_GOV_IN_API_KEY/);

  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    return {
      ok: true,
      status: 200,
      async json() {
        return { total: 42, count: 1, records: [{ indicator: "CPI", value: 4.2 }] };
      }
    };
  };

  const client = createDataGovClient({ apiKey: "test-key", fetchImpl, cache: createTtlCache() });
  const data = await client.fetchResource("resource-id_1", { limit: 500, filters: { state: "Delhi" } });
  assert.equal(data.count, 1);
  assert.equal(data.total, 42);
  assert.equal(data.limit, 100, "limit is clamped to the platform maximum");
  assert.equal(data.official, true);
  assert.match(requests[0], /api-key=test-key/);
  assert.match(requests[0], /limit=100/);
  assert.match(requests[0], /state=Delhi/);

  await client.fetchResource("resource-id_1", { limit: 500, filters: { state: "Delhi" } });
  assert.equal(requests.length, 1, "repeat call served from cache");

  await assert.rejects(() => client.fetchResource("bad id!"), /valid data\.gov\.in resource id/);
});
