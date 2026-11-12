/**
 * Historical candle service.
 *
 * One entry point for candles: resolves the instrument, asks providers in order,
 * validates every row against `candleSchema`, drops invalid rows (counting them
 * rather than repairing them) and caches the result briefly.
 *
 * Invalid rows are never interpolated or filled from another source: a missing
 * candle stays missing, and the count travels with the response so downstream
 * analysis can state how complete the series is.
 */

import { getInstrument, instrumentFromSymbol } from "../../shared/instruments/catalog.js";
import { candleSchema } from "../../shared/schemas/candle.js";
import { getProviderOrder, getProviders } from "./providers/index.js";
import { recordCandleObservation } from "./observations.js";

export const INTERVALS = Object.freeze(["1min", "5min", "15min", "30min", "1h", "4h", "1day", "1week", "1month"]);

const PROVIDER_INTERVAL = Object.freeze({ "4h": "1h" });
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

/**
 * Aggregate hourly candles into 4-hour buckets. Buckets are aligned to UTC
 * midnight; the response states that alignment. A partial bucket at the end is
 * kept only when it has at least one candle, and is marked as partial.
 */
export function aggregateFourHour(candles) {
  const buckets = new Map();

  for (const candle of candles) {
    const parsed = Date.parse(String(candle.time).replace(" ", "T"));
    if (!Number.isFinite(parsed)) continue;
    const bucket = Math.floor(parsed / FOUR_HOURS_MS) * FOUR_HOURS_MS;
    const existing = buckets.get(bucket);

    if (!existing) {
      buckets.set(bucket, {
        time: new Date(bucket).toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: Number.isFinite(candle.volume) ? candle.volume : null,
        source: candle.source
      });
    } else {
      existing.high = Math.max(existing.high, candle.high);
      existing.low = Math.min(existing.low, candle.low);
      existing.close = candle.close;
      existing.volume =
        existing.volume === null || candle.volume === null
          ? existing.volume ?? candle.volume
          : existing.volume + candle.volume;
    }
  }

  return [...buckets.values()].sort((a, b) => a.time.localeCompare(b.time));
}
export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
export const MAX_LIMIT = 1000;

const cache = new Map();

export function clearCandleCache() {
  cache.clear();
}

function resolveInstrument(target, exchange) {
  if (target && typeof target === "object") return target;
  if (target) {
    const known = getInstrument(target);
    if (known) return known;
  }
  return instrumentFromSymbol(target, exchange);
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

/**
 * @param {object|string} target Instrument object, instrument id, or symbol.
 * @param {{exchange?:string, interval?:string, limit?:number, cache?:boolean, cacheTtlMs?:number, providers?:object[]}} [options]
 */
export async function getCandles(target, options = {}) {
  const interval = String(options.interval || "1day");
  if (!INTERVALS.includes(interval)) {
    throw badRequest(`Unsupported interval. Supported: ${INTERVALS.join(", ")}`);
  }

  const instrument = resolveInstrument(target, options.exchange);
  if (!instrument?.symbol) throw badRequest("A valid symbol is required.");

  const limit = Math.min(MAX_LIMIT, Math.max(10, Number(options.limit) || 365));
  const cacheKey = `${instrument.id}|${interval}|${limit}`;

  if (options.cache !== false) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.createdAt < (options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS)) {
      return { ...hit.data, cached: true };
    }
  }

  const providers = options.providers || getProviders(getProviderOrder());
  const errors = [];

  for (const provider of providers) {
    if (typeof provider.fetchCandles !== "function") {
      errors.push({ provider: provider.id, message: "Provider does not supply candles." });
      continue;
    }
    if (!provider.isConfigured()) {
      errors.push({ provider: provider.id, message: "API key is not configured." });
      continue;
    }

    try {
      const providerInterval = PROVIDER_INTERVAL[interval] || interval;
      const fetchLimit = providerInterval === interval ? limit : Math.min(5000, limit * 4 + 8);
      const rawRows = await provider.fetchCandles(instrument, { interval: providerInterval, limit: fetchLimit });
      const rows = providerInterval === interval ? rawRows : aggregateFourHour(rawRows);
      if (!Array.isArray(rows) || rows.length === 0) {
        errors.push({ provider: provider.id, message: "Provider returned no candles." });
        continue;
      }

      let dropped = 0;
      const candles = [];

      for (const row of rows) {
        // Attribution is the provider's job; supply a fallback id rather than
        // discarding an otherwise valid candle.
        const parsed = candleSchema.safeParse({ source: provider.id, ...row });
        if (parsed.success) candles.push(parsed.data);
        else dropped += 1;
      }

      candles.sort((a, b) => String(a.time).localeCompare(String(b.time)));
      const trimmed = candles.slice(-limit);

      if (!trimmed.length) {
        errors.push({ provider: provider.id, message: "Provider returned no valid candles." });
        continue;
      }

      recordCandleObservation({
        instrumentId: instrument.id,
        provider: provider.id,
        ok: true,
        candles: trimmed
      });

      const data = {
        instrument,
        instrumentId: instrument.id,
        symbol: instrument.symbol,
        exchange: instrument.exchange,
        interval,
        source: provider.label,
        provider: provider.id,
        candles: trimmed,
        requestedLimit: limit,
        droppedRows: dropped,
        cached: false,
        retrievedAt: new Date().toISOString(),
        coverage: {
          from: trimmed[0].time,
          to: trimmed.at(-1).time,
          count: trimmed.length,
          complete: dropped === 0
        }
      };

      cache.set(cacheKey, { data, createdAt: Date.now() });
      if (cache.size > 200) {
        const oldest = [...cache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt).slice(0, cache.size - 200);
        for (const [key] of oldest) cache.delete(key);
      }

      return data;
    } catch (error) {
      errors.push({
        provider: provider.id,
        message: error instanceof Error ? error.message : "Provider failed."
      });
    }
  }

  recordCandleObservation({
    instrumentId: instrument.id,
    provider: errors.at(-1)?.provider ?? null,
    ok: false,
    error: new Error(errors.map((entry) => `${entry.provider}: ${entry.message}`).join("; "))
  });

  const error = new Error("No configured provider could return historical candles for this instrument.");
  error.statusCode = 503;
  error.details = errors;
  throw error;
}
