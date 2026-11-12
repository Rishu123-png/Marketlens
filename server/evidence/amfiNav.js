/**
 * AMFI official mutual-fund / ETF NAV reference.
 *
 * Source: the Association of Mutual Funds in India publishes a single
 * pipe-delimited end-of-day file of scheme NAVs. It needs no key, covers Indian
 * schemes (including ETFs), and is the *official* NAV — unlike a vendor quote.
 *
 * Important semantics: this is an end-of-day reference value, **not** a live
 * price and not a candle. It is surfaced as evidence/valuation context with
 * `delayed: true` so the UI never presents it as the current market price.
 *
 * AMFI's host has intermittently 404'd on the canonical path, so several
 * documented paths are tried in order and the file is cached for six hours.
 */

import { officialSourceCache } from "./cache.js";

export const AMFI_URLS = [
  "https://www.amfiindia.com/spages/NAVAll.txt",
  "https://portal.amfiindia.com/spages/NAVAll.txt",
  "https://www.amfiindia.com/spages/NavOpen.txt"
];

export const AMFI_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function normalizeIsin(value) {
  const isin = String(value ?? "").trim().toUpperCase();
  return /^IN[A-Z0-9]{10}$/.test(isin) ? isin : null;
}

function normalizeSchemeCode(value) {
  const code = String(value ?? "").trim();
  return /^\d{4,8}$/.test(code) ? code : null;
}

/**
 * Parse the AMFI NAV file.
 * Lines are `code;isin1;isin2;name;nav;date`; lines without `;` are section
 * headers and are kept as the category for the schemes that follow.
 */
export function parseNavAll(text) {
  const schemes = [];
  const byIsin = new Map();
  const byCode = new Map();
  let category = null;
  let asOf = null;

  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (!line.includes(";")) {
      category = line.replace(/^[-\s]+|[-\s]+$/g, "").slice(0, 120) || null;
      continue;
    }

    const parts = line.split(";").map((part) => part.trim());
    if (parts.length < 6) continue;

    const [schemeCode, isin1, isin2, name, navRaw, dateRaw] = parts;
    const nav = Number(navRaw);
    if (!schemeCode || !name || !Number.isFinite(nav) || nav <= 0) continue;

    const isins = [normalizeIsin(isin1), normalizeIsin(isin2)].filter(Boolean);
    const scheme = {
      schemeCode,
      isins,
      name: name.slice(0, 200),
      nav,
      date: dateRaw || null,
      category
    };

    schemes.push(scheme);
    byCode.set(schemeCode, scheme);
    for (const isin of isins) if (!byIsin.has(isin)) byIsin.set(isin, scheme);
    if (scheme.date && (!asOf || scheme.date > asOf)) asOf = scheme.date;
  }

  return { schemes, byIsin, byCode, asOf, count: schemes.length };
}

export function createAmfiNavClient({
  fetchImpl = globalThis.fetch,
  cache = officialSourceCache,
  urls = AMFI_URLS,
  timeoutMs = 10_000
} = {}) {
  const attempts = [];

  async function loadIndex() {
    const { value } = await cache.getOrLoad("amfi:navall", AMFI_CACHE_TTL_MS, async () => {
      const failures = [];

      for (const url of urls) {
        try {
          const response = await fetchImpl(url, {
            headers: { accept: "text/plain", "user-agent": "MarketLens/1.0 (NAV reference)" },
            signal: AbortSignal.timeout(timeoutMs)
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const text = await response.text();
          const parsed = parseNavAll(text);
          if (parsed.count === 0) throw new Error("NAV file contained no parsable schemes.");
          return { ...parsed, url };
        } catch (error) {
          failures.push(`${url}: ${error instanceof Error ? error.message : "failed"}`);
        }
      }

      attempts.push(...failures);
      throw new Error(`AMFI NAV file unavailable (${failures.join("; ")}).`);
    });

    return value;
  }

  return {
    id: "amfi-nav",
    label: "AMFI official NAV",
    sourceType: "nav",

    isConfigured() {
      return true;
    },

    /** Look up one scheme by ISIN (preferred) or AMFI scheme code. */
    async lookup({ isin, schemeCode } = {}) {
      const normalizedIsin = normalizeIsin(isin);
      const normalizedCode = normalizeSchemeCode(schemeCode);

      if (!normalizedIsin && !normalizedCode) {
        const error = new Error("Provide a valid ISIN (IN…) or AMFI scheme code.");
        error.statusCode = 400;
        throw error;
      }

      const index = await loadIndex();
      const scheme = normalizedIsin ? index.byIsin.get(normalizedIsin) : index.byCode.get(normalizedCode);

      if (!scheme) {
        return {
          status: "not-found",
          query: { isin: normalizedIsin, schemeCode: normalizedCode },
          asOf: index.asOf,
          source: "AMFI",
          delayed: true,
          note: "No scheme in the official AMFI file matched this identifier."
        };
      }

      return {
        status: "available",
        query: { isin: normalizedIsin, schemeCode: normalizedCode },
        scheme,
        asOf: scheme.date ?? index.asOf,
        retrievedFrom: index.url,
        source: "AMFI",
        official: true,
        delayed: true,
        note: "Official end-of-day NAV. Not a live price and not a candle."
      };
    },

    async stats() {
      const index = await loadIndex();
      return { schemes: index.count, asOf: index.asOf, attemptedUrls: urls.length, failures: attempts.slice(-3) };
    }
  };
}

export const amfiNavClient = createAmfiNavClient();
