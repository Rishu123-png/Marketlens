/**
 * SEC EDGAR adapter (official US filings).
 *
 * Documented interfaces only:
 * - https://www.sec.gov/files/company_tickers.json   (ticker → CIK)
 * - https://data.sec.gov/submissions/CIK##########.json
 * - https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json
 *
 * Access rules enforced here, not left to callers:
 * - a descriptive User-Agent with contact details is mandatory (SEC policy);
 *   without `SEC_USER_AGENT` the adapter is disabled rather than anonymous;
 * - at most 10 requests/second, serialised client-side;
 * - responses are cached (24 h for ticker map and company facts, 1 h for
 *   submissions) because filings change slowly and SEC asks clients to cache.
 *
 * Nothing here produces prices, candles or volume: EDGAR is a filings and
 * company-facts source.
 */

import { officialSourceCache } from "./cache.js";

export const SEC_MIN_INTERVAL_MS = 100;
export const SEC_CACHE_TTL_MS = {
  tickers: 24 * 60 * 60 * 1000,
  submissions: 60 * 60 * 1000,
  facts: 24 * 60 * 60 * 1000
};

const US_EXCHANGES = new Set(["NYSE", "NASDAQ", "AMEX", "NYSEARCA"]);

function padCik(value) {
  return String(value).replace(/^0+/, "").padStart(10, "0");
}

function archiveUrl(cik, accessionNumber, primaryDocument) {
  const accession = String(accessionNumber ?? "").replace(/-/g, "");
  if (!accession || !primaryDocument) return null;
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession}/${primaryDocument}`;
}

function isoDate(value) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function isUsInstrument(instrument) {
  return Boolean(instrument?.exchange && US_EXCHANGES.has(String(instrument.exchange).toUpperCase()));
}

export function createSecClient({
  fetchImpl = globalThis.fetch,
  userAgent = process.env.SEC_USER_AGENT,
  cache = officialSourceCache,
  minIntervalMs = SEC_MIN_INTERVAL_MS,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  let lastRequestAt = 0;

  function isConfigured() {
    return Boolean(userAgent && /@/.test(String(userAgent)));
  }

  async function request(url) {
    if (!isConfigured()) {
      throw new Error("SEC EDGAR requires SEC_USER_AGENT with an app name and contact email.");
    }

    const wait = lastRequestAt + minIntervalMs - now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = now();

    const response = await fetchImpl(url, {
      headers: {
        "user-agent": userAgent,
        accept: "application/json",
        "accept-encoding": "gzip, deflate"
      },
      signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) {
      const error = new Error(`SEC EDGAR responded ${response.status} for ${url}`);
      error.status = response.status;
      throw error;
    }

    return response.json();
  }

  async function tickerMap() {
    const { value } = await cache.getOrLoad("sec:tickers", SEC_CACHE_TTL_MS.tickers, async () => {
      const data = await request("https://www.sec.gov/files/company_tickers.json");
      const map = new Map();
      for (const row of Object.values(data ?? {})) {
        if (row?.ticker && row?.cik_str) {
          map.set(String(row.ticker).toUpperCase(), { cik: Number(row.cik_str), title: row.title ?? null });
        }
      }
      return map;
    });
    return value;
  }

  async function cikForTicker(ticker) {
    const map = await tickerMap();
    const entry = map.get(String(ticker ?? "").toUpperCase());
    return entry ? { cik: entry.cik, title: entry.title } : null;
  }

  async function submissions(cik) {
    const padded = padCik(cik);
    const { value } = await cache.getOrLoad(`sec:submissions:${padded}`, SEC_CACHE_TTL_MS.submissions, () =>
      request(`https://data.sec.gov/submissions/CIK${padded}.json`)
    );
    return value;
  }

  async function companyFacts(cik) {
    const padded = padCik(cik);
    const { value } = await cache.getOrLoad(`sec:facts:${padded}`, SEC_CACHE_TTL_MS.facts, () =>
      request(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`)
    );
    return value;
  }

  /**
   * Recent filings as evidence items, newest first.
   * @returns {Promise<{items: object[], company: string|null, cik: number}>}
   */
  async function filingsForTicker(ticker, { limit = 10, sinceDays = 365 } = {}) {
    const resolved = await cikForTicker(ticker);
    if (!resolved) {
      const error = new Error(`No SEC CIK is published for ticker ${ticker}.`);
      error.status = 404;
      throw error;
    }

    const data = await submissions(resolved.cik);
    const recent = data?.filings?.recent ?? {};
    const forms = Array.isArray(recent.form) ? recent.form : [];
    const cutoff = sinceDays > 0 ? now() - sinceDays * 24 * 60 * 60 * 1000 : null;
    const company = data?.name ?? resolved.title ?? null;
    const items = [];

    for (let index = 0; index < forms.length && items.length < limit; index += 1) {
      const filedAt = isoDate(recent.filingDate?.[index]);
      if (cutoff && filedAt && Date.parse(filedAt) < cutoff) continue;

      const accessionNumber = recent.accessionNumber?.[index] ?? null;
      const primaryDocument = recent.primaryDocument?.[index] ?? null;

      items.push({
        title: `${forms[index]} — ${company ?? ticker}`.slice(0, 300),
        url: archiveUrl(resolved.cik, accessionNumber, primaryDocument),
        publisher: "SEC EDGAR",
        publishedAt: filedAt,
        excerpt: recent.primaryDocDescription?.[index] || recent.items?.[index] || `${forms[index]} filing`,
        sourceType: "filing",
        verification: "verified",
        provider: "sec-edgar",
        language: "en",
        metadata: {
          cik: resolved.cik,
          accessionNumber,
          form: forms[index],
          reportDate: recent.reportDate?.[index] ?? null,
          liveVerified: true,
          interface: "data.sec.gov/submissions"
        }
      });
    }

    return { items, company, cik: resolved.cik };
  }

  /** Latest reported value for one XBRL tag, in USD unless the tag says otherwise. */
  async function latestFact(cik, tag) {
    const facts = await companyFacts(cik);
    const units = facts?.facts?.["us-gaap"]?.[tag]?.units;
    if (!units) return null;
    const observations = Object.values(units).flat();
    const latest = observations
      .filter((row) => row?.val !== undefined)
      .sort((a, b) => String(b.end ?? "").localeCompare(String(a.end ?? "")))[0];
    if (!latest) return null;
    return {
      tag,
      value: latest.val,
      unit: Object.keys(units)[0],
      end: latest.end ?? null,
      filed: latest.filed ?? null,
      form: latest.form ?? null,
      fiscalYear: latest.fy ?? null,
      fiscalPeriod: latest.fp ?? null
    };
  }

  return { isConfigured, cikForTicker, submissions, companyFacts, filingsForTicker, latestFact };
}

export const secClient = createSecClient();

/** Filing provider used by `gatherEvidence` for US-listed instruments. */
export const secEdgarFilingsProvider = {
  id: "sec-edgar",
  label: "SEC EDGAR filings",
  sourceType: "filing",

  isConfigured() {
    return secClient.isConfigured();
  },

  supports(instrument) {
    return isUsInstrument(instrument);
  },

  async search({ instrument, limit = 10 }) {
    if (!isUsInstrument(instrument)) {
      throw new Error("SEC EDGAR filings only apply to US-listed instruments.");
    }
    const { items } = await secClient.filingsForTicker(instrument.symbol, { limit, sinceDays: 400 });
    return items;
  }
};
