/**
 * Provider payload → one internal quote shape.
 *
 * Providers disagree about field names and number formatting. Everything that
 * leaves this module looks identical regardless of who supplied it, so no agent
 * or endpoint needs to know which provider answered.
 */

import { parseNumber, parseTimestamp } from "./http.js";

/** The normalized quote contract. Kept in sync with shared/schemas. */
export function normalizeQuote({ item = {}, instrument, source, provider, providerTimestamp = null }) {
  if (!instrument) throw new Error("normalizeQuote requires an instrument.");

  const price = parseNumber(item.price ?? item.close ?? item["05. price"]);
  const retrievedAt = new Date().toISOString();

  return {
    mode: "verified",
    quoteVerified: price !== null,

    instrumentId: instrument.id,
    symbol: instrument.symbol,
    displaySymbol: instrument.symbol,
    name: instrument.name,
    exchange: instrument.exchange || "Unknown",
    country: instrument.country || null,
    currency: instrument.currency || null,
    assetType: instrument.assetType || "equity",

    price,
    change: parseNumber(item.change ?? item["09. change"]),
    changePercent: parseNumber(
      item.changesPercentage ??
        item.changePercentage ??
        item.change_percent ??
        item.percent_change ??
        item["10. change percent"]
    ),
    open: parseNumber(item.open ?? item["02. open"]),
    previousClose: parseNumber(item.previousClose ?? item.previous_close ?? item["08. previous close"]),
    dayHigh: parseNumber(item.dayHigh ?? item.high ?? item["03. high"]),
    dayLow: parseNumber(item.dayLow ?? item.low ?? item["04. low"]),
    volume: parseNumber(item.volume ?? item["06. volume"]),

    source,
    provider,
    // Identity evidence from the provider, used by the gateway to reject a
    // silently mis-resolved ticker (e.g. a US listing quoted for an NSE stock).
    providerSymbol: item.symbol ? String(item.symbol) : null,
    providerExchange: item.exchange ?? item.exchangeShortName ?? item.primaryExchange ?? null,
    providerCurrency: item.currency ?? null,

    // `updatedAt` is the retrieval time and predates this normalization layer;
    // it is kept so existing clients and reports keep working.
    updatedAt: retrievedAt,
    retrievedAt,
    providerTimestamp: providerTimestamp || parseTimestamp(item.timestamp ?? item.last_trade_time),
    freshness: "verified"
  };
}

export function normalizeCandle(row, source) {
  const candle = {
    time: row.datetime || row.date || row.timestamp || row.time,
    open: parseNumber(row.open),
    high: parseNumber(row.high),
    low: parseNumber(row.low),
    close: parseNumber(row.close),
    volume: parseNumber(row.volume),
    source
  };

  const usable =
    Boolean(candle.time) &&
    [candle.open, candle.high, candle.low, candle.close].every((value) => value !== null);

  return usable ? candle : null;
}
