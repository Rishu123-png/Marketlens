/**
 * Market overview aggregation.
 *
 * Everything here is derived from provider-verified quotes; missing quotes are
 * reported as missing. Breadth, sector performance and movers are computed over
 * the verified subset only, and the response states that subset's size so a
 * "60% advancing" label can never be mistaken for the whole market.
 */

import { getInstrument, POPULAR_INDIAN_EQUITY_IDS } from "../../shared/instruments/catalog.js";
import { getVerifiedQuote, mapConcurrent } from "../market-data/gateway.js";
import { getProviders } from "../market-data/providers/index.js";
import { buildInstrumentMatrix } from "../instruments/service.js";

export const OVERVIEW_VERSION = "1.0.0";
export const OVERVIEW_CACHE_TTL_MS = 90_000;
const CONCURRENCY = 8;

const INDEX_IDS = ["IN-IDX-NIFTY50", "IN-IDX-NIFTYBANK", "IN-IDX-NIFTYIT", "IN-IDX-SENSEX"];

let cached = null;
let cachedAt = 0;

export function clearOverviewCache() {
  cached = null;
  cachedAt = 0;
}

/** NSE cash session in IST. Public holidays are not verified by this function. */
export function marketSession(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);

  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = get("weekday");
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  const weekend = weekday === "Sat" || weekday === "Sun";
  const open = !weekend && minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;

  let status = "closed";
  if (weekend) status = "weekend";
  else if (open) status = "open";
  else if (minutes < 9 * 60 + 15) status = "pre-open";

  return {
    exchange: "NSE",
    timezone: "Asia/Kolkata",
    status,
    label:
      status === "open"
        ? "NSE cash session open"
        : status === "pre-open"
          ? "NSE pre-open window"
          : status === "weekend"
            ? "NSE weekend — closed"
            : "NSE cash session closed",
    istTime: `${get("hour")}:${get("minute")}`,
    holidayCalendar: "not-verified",
    note: "Session clock only; exchange holidays are not inferred."
  };
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (!usable.length) return null;
  return Number((usable.reduce((sum, value) => sum + value, 0) / usable.length).toFixed(3));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function quoteFor(instrument) {
  try {
    return { instrument, quote: await getVerifiedQuote(instrument), error: null };
  } catch (error) {
    return {
      instrument,
      quote: null,
      error: {
        message: error instanceof Error ? error.message : "Quote unavailable.",
        details: error?.details ?? null
      }
    };
  }
}

function card(entry) {
  return {
    id: entry.instrument.id,
    symbol: entry.instrument.symbol.replace(/^\^/, ""),
    displaySymbol: entry.instrument.symbol,
    name: entry.instrument.name,
    exchange: entry.instrument.exchange,
    assetType: entry.instrument.assetType,
    quote: entry.quote
      ? {
          price: entry.quote.price,
          currency: entry.quote.currency,
          change: entry.quote.change,
          changePercent: entry.quote.changePercent,
          dayHigh: entry.quote.dayHigh,
          dayLow: entry.quote.dayLow,
          volume: entry.quote.volume,
          source: entry.quote.source,
          provider: entry.quote.provider,
          providerTimestamp: entry.quote.providerTimestamp,
          retrievedAt: entry.quote.retrievedAt
        }
      : null,
    error: entry.error
  };
}

export async function buildMarketOverview({ now = new Date(), quotes = null } = {}) {
  if (!quotes && cached && Date.now() - cachedAt < OVERVIEW_CACHE_TTL_MS) {
    return { ...cached, cached: true };
  }

  const indices = INDEX_IDS.map(getInstrument).filter(Boolean);
  const universe = POPULAR_INDIAN_EQUITY_IDS.map(getInstrument).filter(Boolean);

  const indexEntries = quotes
    ? quotes.filter((entry) => entry.instrument.assetType === "index")
    : await mapConcurrent(indices, CONCURRENCY, quoteFor);

  const stockEntries = quotes
    ? quotes.filter((entry) => entry.instrument.assetType !== "index")
    : await mapConcurrent(universe, CONCURRENCY, quoteFor);

  const verifiedStocks = stockEntries.filter((entry) => entry.quote);
  const changes = verifiedStocks.map((entry) => numberOrNull(entry.quote.changePercent)).filter((value) => value !== null);
  const advancers = changes.filter((value) => value > 0).length;
  const decliners = changes.filter((value) => value < 0).length;
  const unchanged = changes.filter((value) => value === 0).length;

  const sectorMap = new Map();
  for (const entry of verifiedStocks) {
    const sector = entry.instrument.sector || "Unclassified";
    const change = numberOrNull(entry.quote.changePercent);
    if (change === null) continue;
    const bucket = sectorMap.get(sector) || { sector, changes: [], instruments: [], advance: 0, decline: 0 };
    bucket.changes.push(change);
    bucket.instruments.push(entry.instrument.symbol);
    if (change > 0) bucket.advance += 1;
    if (change < 0) bucket.decline += 1;
    sectorMap.set(sector, bucket);
  }

  const sectors = [...sectorMap.values()]
    .map((bucket) => ({
      sector: bucket.sector,
      averageChangePercent: average(bucket.changes),
      count: bucket.changes.length,
      advancers: bucket.advance,
      decliners: bucket.decline,
      instruments: bucket.instruments.slice(0, 8)
    }))
    .sort((a, b) => (b.averageChangePercent ?? -Infinity) - (a.averageChangePercent ?? -Infinity));

  const withChange = verifiedStocks
    .filter((entry) => numberOrNull(entry.quote.changePercent) !== null)
    .sort((a, b) => Number(b.quote.changePercent) - Number(a.quote.changePercent));

  const volumeLeaders = verifiedStocks
    .filter((entry) => numberOrNull(entry.quote.volume) > 0)
    .sort((a, b) => Number(b.quote.volume) - Number(a.quote.volume))
    .slice(0, 8);

  const providerErrors = {};
  for (const entry of [...indexEntries, ...stockEntries]) {
    for (const detail of entry.error?.details ?? []) {
      const key = detail.provider || "unknown";
      providerErrors[key] = providerErrors[key] ?? { provider: key, failures: 0, example: detail.message };
      providerErrors[key].failures += 1;
    }
  }

  const matrix = buildInstrumentMatrix({ now: () => now });
  const totalAttempted = indexEntries.length + stockEntries.length;
  const verifiedTotal = indexEntries.filter((entry) => entry.quote).length + verifiedStocks.length;
  const quoteProviders = getProviders().filter((provider) => provider.isConfigured()).map((provider) => provider.id);

  const payload = {
    version: OVERVIEW_VERSION,
    generatedAt: now.toISOString(),
    cached: false,
    market: marketSession(now),
    indices: indexEntries.map(card),
    // Feature a small fixed subset even when a quote has no change value or is
    // not a top mover. Each quote still comes from the verified gateway path.
    featuredStocks: stockEntries.slice(0, 4).map(card),
    breadth: {
      universeAttempted: stockEntries.length,
      verified: verifiedStocks.length,
      unverified: stockEntries.length - verifiedStocks.length,
      advancers,
      decliners,
      unchanged,
      changesAvailable: changes.length,
      advancePercent: changes.length ? Number(((advancers / changes.length) * 100).toFixed(1)) : null,
      basis: "verified quotes only, popular Indian universe",
      note:
        "Breadth uses verified quotes with a reported percentage change, not the whole exchange. It is not exchange-wide market breadth."
    },
    sectors,
    gainers: withChange.filter((entry) => Number(entry.quote.changePercent) > 0).slice(0, 8).map(card),
    losers: withChange.filter((entry) => Number(entry.quote.changePercent) < 0).slice(-8).reverse().map(card),
    volumeLeaders: volumeLeaders.map(card),
    heatmap: stockEntries.map((entry) => ({
      id: entry.instrument.id,
      symbol: entry.instrument.symbol,
      sector: entry.instrument.sector,
      changePercent: entry.quote ? numberOrNull(entry.quote.changePercent) : null,
      price: entry.quote?.price ?? null,
      currency: entry.quote?.currency ?? entry.instrument.currency,
      verified: Boolean(entry.quote)
    })),
    coverage: {
      attempted: totalAttempted,
      verified: verifiedTotal,
      verifiedPercent: totalAttempted ? Number(((verifiedTotal / totalAttempted) * 100).toFixed(1)) : 0,
      status:
        verifiedTotal === 0
          ? "no-verified-quotes"
          : verifiedTotal < totalAttempted / 2
            ? "low-coverage"
            : verifiedTotal < totalAttempted
              ? "partial-coverage"
              : "full-coverage",
      configuredQuoteProviders: quoteProviders,
      freshness: matrix.freshness,
      instrumentMatrix: {
        catalogued: matrix.catalogued,
        quoteEnabled: matrix.coverage.quoteEnabled,
        verifiedLatestQuote: matrix.coverage.verifiedLatestQuote,
        candleEnabled: matrix.coverage.candleEnabled
      },
      providerFailures: Object.values(providerErrors)
    },
    limitations: [
      "Only provider-verified quotes are included; no price is estimated or carried forward.",
      "Free provider tiers are delayed/end-of-day; nothing here is labelled real-time.",
      "Breadth and sector performance cover the attempted popular universe, not every listed stock."
    ]
  };

  if (!quotes) {
    cached = payload;
    cachedAt = Date.now();
  }

  return payload;
}
