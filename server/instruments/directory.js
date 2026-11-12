/**
 * Provider-backed instrument directory.
 *
 * The bundled catalogue is a curated snapshot; it is not the NSE/BSE listing.
 * When a market-data provider exposes a symbol directory, that directory is
 * fetched (server-side, cached, bounded) and merged into search so the universe
 * is not limited to the bundled names.
 *
 * Failure is explicit: `status` says whether the directory was fetched, is
 * stale, or is unavailable, and why. Search still works against the bundled
 * catalogue when no directory is reachable.
 */

import { instrumentFromSymbol } from "../../shared/instruments/catalog.js";

export const DIRECTORY_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_DIRECTORY_ENTRIES = 20_000;
const FETCH_TIMEOUT_MS = 12_000;
const ALLOWED_VENUES = new Set(["NSE", "BSE", "NASDAQ", "NYSE", "AMEX", "NYSE ARCA"]);

let cache = { instruments: [], fetchedAt: null, provider: null, errors: [], attemptedAt: null };
let inFlight = null;

async function fetchJson(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Directory provider returned non-JSON (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      throw new Error(data?.message || data?.error || `Directory provider HTTP ${response.status}.`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function typeOf(row) {
  const raw = String(row.type || row.instrument_type || "").toLowerCase();
  if (raw.includes("etf") || raw.includes("fund")) return "etf";
  if (raw.includes("index")) return "index";
  return "equity";
}

function toDirectoryInstrument(row, provider) {
  const exchange = String(row.exchangeShortName || row.exchange || "").trim().toUpperCase();
  const symbol = String(row.symbol || "").trim().toUpperCase();
  if (!ALLOWED_VENUES.has(exchange) || !symbol) return null;

  const base = instrumentFromSymbol(symbol, exchange);
  if (!base) return null;

  return Object.freeze({
    ...base,
    name: String(row.name || row.companyName || symbol).slice(0, 160),
    assetType: typeOf(row),
    sector: row.sector || "Unclassified",
    providers: null,
    source: `${provider}-directory`
  });
}

async function fetchFmpDirectory() {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error("FMP_API_KEY is not configured.");
  const data = await fetchJson(
    `https://financialmodelingprep.com/api/v3/stock/list?apikey=${encodeURIComponent(key)}`
  );
  if (!Array.isArray(data)) throw new Error("FMP directory response was not an array.");
  return data;
}

async function fetchTwelveDirectory() {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("TWELVE_DATA_API_KEY is not configured.");
  const exchanges = ["NSE", "BSE"];
  const rows = [];
  for (const exchange of exchanges) {
    const data = await fetchJson(
      `https://api.twelvedata.com/stocks?exchange=${exchange}&country=India&apikey=${encodeURIComponent(key)}`
    );
    if (Array.isArray(data?.data)) rows.push(...data.data);
    else if (data?.status === "error") throw new Error(data.message || "Twelve directory error.");
  }
  return rows;
}

async function loadDirectory() {
  const errors = [];
  const attempts = [
    ["fmp", fetchFmpDirectory],
    ["twelve", fetchTwelveDirectory]
  ];

  for (const [provider, run] of attempts) {
    try {
      const rows = await run();
      const instruments = rows
        .map((row) => toDirectoryInstrument(row, provider))
        .filter(Boolean)
        .slice(0, MAX_DIRECTORY_ENTRIES);

      if (!instruments.length) {
        errors.push({ provider, message: "Directory returned no usable NSE/BSE/US listings." });
        continue;
      }

      return { instruments, provider, fetchedAt: new Date().toISOString(), errors };
    } catch (error) {
      errors.push({ provider, message: error instanceof Error ? error.message : "Directory fetch failed." });
    }
  }

  return { instruments: [], provider: null, fetchedAt: null, errors };
}

export function directoryStatus() {
  const stale = Boolean(cache.fetchedAt) && Date.now() - Date.parse(cache.fetchedAt) > DIRECTORY_TTL_MS;
  return {
    status: cache.instruments.length ? (stale ? "stale" : "available") : cache.attemptedAt ? "unavailable" : "unfetched",
    provider: cache.provider,
    fetchedAt: cache.fetchedAt,
    attemptedAt: cache.attemptedAt,
    count: cache.instruments.length,
    errors: cache.errors,
    note: "Provider directory coverage depends on the plan and is not a complete exchange master."
  };
}

/**
 * @param {{refresh?:boolean}} [options]
 */
export async function getDirectory({ refresh = false } = {}) {
  const fresh =
    cache.instruments.length &&
    cache.fetchedAt &&
    Date.now() - Date.parse(cache.fetchedAt) < DIRECTORY_TTL_MS;

  if (!refresh && fresh) return { ...cache, status: directoryStatus() };

  if (inFlight) return inFlight;
  inFlight = (async () => {
    const result = await loadDirectory();
    cache = { ...result, attemptedAt: new Date().toISOString() };
    inFlight = null;
    return { ...cache, status: directoryStatus() };
  })();

  try {
    return await inFlight;
  } catch (error) {
    inFlight = null;
    throw error;
  }
}

export function clearDirectoryCache() {
  cache = { instruments: [], fetchedAt: null, provider: null, errors: [], attemptedAt: null };
  inFlight = null;
}
