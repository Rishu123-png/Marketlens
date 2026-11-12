// Unified instrument search.
//
// The bundled catalogue and cached provider directory are searched locally and
// ranked first, so search is never limited to whichever symbols a vendor happens
// to return. Optional provider symbol searches then add instruments outside the
// master. Results carry asset type, exchange and provider availability, but no
// result is presented as having a verified quote.
import { rateLimit } from "../lib/server/rateLimit.js";
import { instrumentFromSymbol } from "../shared/instruments/catalog.js";
import { publicInstrument, searchInstrumentMaster } from "../server/instruments/service.js";

function send(res, status, body) {
  return res.status(status).json(body);
}

async function getJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(text.slice(0, 200) || `Provider HTTP ${response.status}`);
    }
    if (!response.ok) {
      throw new Error(data?.message || data?.error || data?.["Error Message"] || `Provider HTTP ${response.status}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function venueOf(result) {
  const text = [result.exchange, result.stockExchange, result.exchangeShortName, result["4. region"]]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  if (text.includes("NSE") || text.includes("NATIONAL STOCK EXCHANGE")) return "NSE";
  if (text.includes("BSE") || text.includes("BOMBAY")) return "BSE";
  if (text.includes("NASDAQ")) return "NASDAQ";
  if (text.includes("NYSE") || text.includes("NEW YORK")) return "NYSE";
  if (text.includes("AMEX")) return "AMEX";
  return String(result.exchangeShortName || result.exchange || "").toUpperCase();
}

function cleanResult(result) {
  const symbol = String(result.symbol || result.ticker || "").trim().toUpperCase();
  return {
    symbol,
    name: String(result.name || result.instrument_name || result["2. name"] || symbol).slice(0, 160),
    exchange: venueOf(result),
    type: result.type || result.instrument_type || result["3. type"] || "Stock"
  };
}

function dedupe(results) {
  const seen = new Set();
  return results.filter((item) => {
    const key = `${item.symbol}|${item.exchange}`;
    if (!item.symbol || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function searchFmp(query) {
  const key = process.env.FMP_API_KEY;
  if (!key) return [];
  const data = await getJson(
    `https://financialmodelingprep.com/api/v3/search?query=${encodeURIComponent(query)}&limit=20&apikey=${encodeURIComponent(key)}`
  );
  return Array.isArray(data) ? data.map(cleanResult) : [];
}

async function searchTwelve(query) {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) return [];
  const data = await getJson(
    `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(query)}&apikey=${encodeURIComponent(key)}`
  );
  return Array.isArray(data?.data) ? data.data.map(cleanResult) : [];
}

async function searchAlpha(query) {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return [];
  const data = await getJson(
    `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(query)}&apikey=${encodeURIComponent(key)}`
  );
  if (data?.Note) throw new Error(data.Note);
  if (data?.Information) throw new Error(data.Information);
  return Array.isArray(data?.bestMatches) ? data.bestMatches.map(cleanResult) : [];
}

export default async function handler(req, res) {
  const quota = await rateLimit(req, { name: "search", limit: 60, windowMs: 60_000 });
  if (!quota.allowed) {
    res.setHeader?.("Retry-After", String(quota.retryAfterSeconds));
    return send(res, 429, {
      error: "Too many search requests. Please try again shortly.",
      retryAfterSeconds: quota.retryAfterSeconds
    });
  }

  const query = String(req.query?.q || "").trim();
  if (query.length < 2) return send(res, 400, { error: "Enter at least two characters." });
  if (query.length > 60) return send(res, 400, { error: "Search query is too long." });

  const limit = Math.min(50, Math.max(1, Number(req.query?.limit) || 20));

  let local = { instruments: [], total: 0, catalogSize: 0, directory: null };
  try {
    local = await searchInstrumentMaster(query, {}, { limit, offset: 0, includeDirectory: true });
  } catch {
    // Local catalogue search cannot realistically fail; provider directory can.
  }

  const errors = [];
  const providerResults = [];

  for (const [provider, run] of [
    ["fmp", searchFmp],
    ["twelve", searchTwelve],
    ["alpha", searchAlpha]
  ]) {
    try {
      providerResults.push(...(await run(query)));
    } catch (error) {
      errors.push({ provider, message: error instanceof Error ? error.message : "Search provider failed." });
    }
  }

  const localIds = new Set(local.instruments.map((instrument) => instrument.id));
  const extras = [];
  for (const item of dedupe(providerResults)) {
    const instrument = instrumentFromSymbol(item.symbol, item.exchange);
    if (!instrument || localIds.has(instrument.id)) continue;
    localIds.add(instrument.id);
    extras.push({ ...publicInstrument(instrument), name: item.name || instrument.name, providerType: item.type });
  }

  const results = [...local.instruments, ...extras].slice(0, limit);

  if (!results.length) {
    return send(res, 404, {
      error:
        "No instruments matched this query in the bundled master or the configured provider directories.",
      details: errors
    });
  }

  return send(res, 200, {
    query,
    total: local.total + extras.length,
    count: results.length,
    results,
    localMatches: local.instruments.length,
    directory: local.directory,
    providerErrors: errors,
    note: "Catalogue/search presence does not imply a verified quote; check availability.quoteEnabled."
  });
}
