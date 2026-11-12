/**
 * Market screener.
 *
 * Stage 1 filters on provider-verified quotes. Technical filters need candles, so
 * they are evaluated on at most `technicalLimit` survivors and every skipped
 * instrument is reported rather than silently excluded. Market capitalisation is
 * not supplied by the configured quote providers, so it is refused explicitly
 * instead of being approximated.
 */

import { getInstrument, listInstruments } from "../../shared/instruments/catalog.js";
import { getCandles } from "../market-data/candles.js";
import { getVerifiedQuote, mapConcurrent } from "../market-data/gateway.js";
import { indicatorSnapshot } from "../indicators/index.js";

export const SCREENER_VERSION = "1.0.0";
const MAX_UNIVERSE = 60;
const MAX_TECHNICAL = 12;

export const SAVED_FILTERS = Object.freeze([
  "priceMin",
  "priceMax",
  "changeMin",
  "changeMax",
  "volumeMin",
  "sector",
  "exchange",
  "assetType",
  "smaCondition",
  "rsiMin",
  "rsiMax"
]);

export const UNSUPPORTED_FILTERS = Object.freeze({
  marketCapMin: "Market capitalisation is not supplied by the configured quote providers; no verified market-cap filter is offered.",
  marketCapMax: "Market capitalisation is not supplied by the configured quote providers; no verified market-cap filter is offered."
});

function numeric(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function within(value, min, max) {
  if (value === null) return false;
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

export function matchesQuoteFilters(row, filters) {
  const price = numeric(row.quote.price);
  const change = numeric(row.quote.changePercent);
  const volume = numeric(row.quote.volume);

  if (filters.priceMin !== null || filters.priceMax !== null) {
    if (!within(price, filters.priceMin, filters.priceMax)) return false;
  }
  if (filters.changeMin !== null || filters.changeMax !== null) {
    if (!within(change, filters.changeMin, filters.changeMax)) return false;
  }
  if (filters.volumeMin !== null && !(volume !== null && volume >= filters.volumeMin)) return false;
  return true;
}

export function technicalMatch(indicators, filters) {
  if (!indicators) return false;
  const lastClose = indicators.lastClose ?? null;

  if (filters.smaCondition) {
    const period = filters.smaCondition.includes("200") ? "sma200" : "sma50";
    const average = indicators.movingAverages?.[period] ?? null;
    if (!Number.isFinite(average) || !Number.isFinite(lastClose)) return false;
    if (filters.smaCondition.startsWith("above") && !(lastClose > average)) return false;
    if (filters.smaCondition.startsWith("below") && !(lastClose < average)) return false;
  }

  if (filters.rsiMin !== null || filters.rsiMax !== null) {
    const rsiValue = numeric(indicators.rsi);
    if (!within(rsiValue, filters.rsiMin, filters.rsiMax)) return false;
  }

  return true;
}

export function parseScreenerFilters(query = {}) {
  const filters = {
    priceMin: numeric(query.priceMin),
    priceMax: numeric(query.priceMax),
    changeMin: numeric(query.changeMin),
    changeMax: numeric(query.changeMax),
    volumeMin: numeric(query.volumeMin),
    sector: String(query.sector || "").trim(),
    exchange: String(query.exchange || "").trim().toUpperCase(),
    assetType: String(query.assetType || "").trim().toLowerCase(),
    smaCondition: String(query.smaCondition || "").trim().toLowerCase(),
    rsiMin: numeric(query.rsiMin),
    rsiMax: numeric(query.rsiMax)
  };

  const unsupported = Object.keys(UNSUPPORTED_FILTERS).filter((key) => query[key] !== undefined && query[key] !== "");
  const errors = [];
  if (unsupported.length) errors.push(...unsupported.map((key) => UNSUPPORTED_FILTERS[key]));

  const smaAllowed = ["", "abovesma50", "belowsma50", "abovesma200", "belowsma200"];
  if (!smaAllowed.includes(filters.smaCondition)) {
    errors.push("smaCondition must be one of aboveSma50, belowSma50, aboveSma200, belowSma200.");
  }

  return { filters, unsupported, errors };
}

function publicRow(row) {
  return {
    id: row.instrument.id,
    symbol: row.instrument.symbol,
    name: row.instrument.name,
    exchange: row.instrument.exchange,
    currency: row.instrument.currency,
    assetType: row.instrument.assetType,
    sector: row.instrument.sector,
    price: row.quote.price,
    change: row.quote.change,
    changePercent: row.quote.changePercent,
    volume: row.quote.volume,
    dayHigh: row.quote.dayHigh,
    dayLow: row.quote.dayLow,
    provider: row.quote.provider,
    source: row.quote.source,
    retrievedAt: row.quote.retrievedAt,
    providerTimestamp: row.quote.providerTimestamp,
    indicators: row.indicators
      ? {
          rsi: row.indicators.rsi,
          sma50: row.indicators.movingAverages?.sma50 ?? null,
          sma200: row.indicators.movingAverages?.sma200 ?? null,
          atr: row.indicators.atr,
          relativeVolume: row.indicators.relativeVolume
        }
      : null,
    technicalStatus: row.technicalStatus
  };
}

export async function runScreener(query = {}) {
  const { filters, unsupported, errors } = parseScreenerFilters(query);
  if (errors.length) {
    const error = new Error(errors[0]);
    error.statusCode = 400;
    error.details = errors;
    throw error;
  }

  const universeLimit = Math.min(MAX_UNIVERSE, Math.max(1, Number(query.universeLimit) || 20));
  const technicalLimit = Math.min(MAX_TECHNICAL, Math.max(0, Number(query.technicalLimit) || MAX_TECHNICAL));

  const pool = listInstruments({
    exchange: filters.exchange,
    assetType: filters.assetType,
    sector: filters.sector
  }).slice(0, universeLimit);

  const quoteRows = await mapConcurrent(pool, 8, async (instrument) => {
    try {
      return { instrument, quote: await getVerifiedQuote(instrument) };
    } catch {
      return null;
    }
  });

  const verified = quoteRows.filter(Boolean);
  const quoteMatched = verified.filter((row) => matchesQuoteFilters(row, filters));
  const needsTechnical = Boolean(filters.smaCondition || filters.rsiMin !== null || filters.rsiMax !== null);

  let technicalEvaluated = 0;
  let rows = quoteMatched;
  const technicalErrors = [];

  if (needsTechnical) {
    const limited = quoteMatched.slice(0, technicalLimit);
    const evaluated = await mapConcurrent(limited, 4, async (row) => {
      try {
        const data = await getCandles(row.instrument, { interval: "1day", limit: 260 });
        const indicators = indicatorSnapshot(data.candles);
        return { ...row, indicators, technicalStatus: "evaluated" };
      } catch (error) {
        technicalErrors.push({
          symbol: row.instrument.symbol,
          message: error instanceof Error ? error.message : "Candles unavailable."
        });
        return { ...row, indicators: null, technicalStatus: "unavailable" };
      }
    });

    technicalEvaluated = evaluated.filter((row) => row.technicalStatus === "evaluated").length;
    rows = evaluated.filter((row) => row.technicalStatus === "evaluated" && technicalMatch(row.indicators, filters));
  }

  return {
    version: SCREENER_VERSION,
    generatedAt: new Date().toISOString(),
    filters,
    unsupportedFilters: unsupported,
    universe: {
      pool: pool.length,
      requestedLimit: universeLimit,
      verifiedQuotes: verified.length,
      quoteMatched: quoteMatched.length,
      technicalEvaluated,
      technicalSkipped: needsTechnical ? Math.max(0, quoteMatched.length - technicalLimit) : 0
    },
    matched: rows.length,
    rows: rows.map(publicRow),
    technicalErrors,
    limitations: [
      "Only provider-verified quotes are screened; missing quotes are excluded, never filled.",
      "Technical conditions require candles and are evaluated on a bounded subset; the response states how many were skipped.",
      "Provider free tiers are delayed; screening results are not real-time.",
      ...(needsTechnical ? ["Instruments without candle history cannot satisfy technical filters and are excluded."] : [])
    ]
  };
}

export { getInstrument };
