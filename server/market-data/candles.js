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
import { dataFreshness, recordCandleObservation, recordMarketRequest } from "./observations.js";
import { checkProvider } from "./providerPolicy.js";
import { candleCacheTtlMs } from "./cachePolicy.js";

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
export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // retained for callers/tests
export const MAX_LIMIT = 1000;

const cache = new Map();
const inflight = new Map();

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
 * Deduplicate concurrent identical candle fetches. Only the same instrument,
 * interval and limit share a request, so one caller cannot receive a shorter
 * series than it asked for.
 */
export async function getCandles(target, options = {}) {
  if (options.cache === false) return getCandlesUncached(target, options);
  const instrument = resolveInstrument(target, options.exchange);
  if (!instrument?.symbol) return getCandlesUncached(target, options);
  const interval = String(options.interval || "1day");
  const limit = Math.min(MAX_LIMIT, Math.max(10, Number(options.limit) || 365));
  const providerKey = options.providers?.map((provider) => provider.id).join(",") || getProviderOrder().join(",");
  const key = `${instrument.id}|${interval}|${limit}|${providerKey}`;
  if (inflight.has(key)) return inflight.get(key);
  const promise = getCandlesUncached(target, options).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/**
 * @param {object|string} target Instrument object, instrument id, or symbol.
 * @param {{exchange?:string, interval?:string, limit?:number, cache?:boolean, cacheTtlMs?:number, providers?:object[]}} [options]
 */
async function getCandlesUncached(target, options = {}) {
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
    if (hit && Date.now() - hit.createdAt < (options.cacheTtlMs ?? candleCacheTtlMs(interval))) {
      recordMarketRequest({
        kind: "candles",
        instrumentId: instrument.id,
        symbol: instrument.symbol,
        exchange: instrument.exchange,
        interval,
        requestedLimit: limit,
        provider: hit.data.provider,
        cacheHit: true,
        returnedCount: hit.data.candles?.length ?? 0,
        droppedCount: hit.data.droppedRows ?? 0,
        durationMs: 0,
        dataTimestamp: hit.data.candles?.at(-1)?.time ?? null,
        freshness: dataFreshness(hit.data.candles?.at(-1)?.time)?.classification ?? "unknown"
      });
      return { ...hit.data, cached: true };
    }
  }

  const providers = options.providers || getProviders(getProviderOrder());
  const errors = [];

  for (const provider of providers) {
    const requestContext = {
      kind: "candles",
      instrumentId: instrument.id,
      symbol: instrument.symbol,
      exchange: instrument.exchange,
      interval,
      requestedLimit: limit,
      provider: provider.id
    };

    if (typeof provider.fetchCandles !== "function") {
      const message = "Provider does not supply candles.";
      errors.push({ provider: provider.id, message });
      recordMarketRequest({ ...requestContext, attempted: false, error: new Error(message) });
      continue;
    }
    if (!provider.isConfigured()) {
      const message = "API key is not configured.";
      errors.push({ provider: provider.id, message });
      recordMarketRequest({ ...requestContext, attempted: false, error: new Error(message) });
      continue;
    }
    if (
      typeof provider.supportsCandleInterval === "function" &&
      !provider.supportsCandleInterval(PROVIDER_INTERVAL[interval] || interval)
    ) {
      const message = "Provider does not support this interval.";
      errors.push({ provider: provider.id, message, reason: "unsupported-interval" });
      recordMarketRequest({ ...requestContext, attempted: false, error: new Error(message) });
      continue;
    }

    const policy = await checkProvider(provider.id);
    if (!policy.allowed) {
      const message = `Provider circuit open (${policy.reason}); retry after ${policy.retryAfterSeconds}s.`;
      errors.push({
        provider: provider.id,
        message,
        reason: policy.reason,
        retryAfterSeconds: policy.retryAfterSeconds
      });
      recordMarketRequest({ ...requestContext, attempted: false, error: new Error(message) });
      continue;
    }

    const attemptStartedAt = Date.now();
    try {
      const providerInterval = PROVIDER_INTERVAL[interval] || interval;
      const fetchLimit = providerInterval === interval ? limit : Math.min(5000, limit * 4 + 8);
      const rawRows = await provider.fetchCandles(instrument, { interval: providerInterval, limit: fetchLimit });
      const rows = providerInterval === interval ? rawRows : aggregateFourHour(rawRows);
      if (!Array.isArray(rows) || rows.length === 0) {
        const message = "Provider returned no candles.";
        errors.push({ provider: provider.id, message });
        recordMarketRequest({
          ...requestContext,
          attempted: true,
          error: new Error(message),
          durationMs: Date.now() - attemptStartedAt
        });
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
        const message = "Provider returned no valid candles.";
        errors.push({ provider: provider.id, message });
        recordMarketRequest({
          ...requestContext,
          attempted: true,
          httpStatus: 200,
          error: new Error(message),
          droppedCount: dropped,
          durationMs: Date.now() - attemptStartedAt
        });
        continue;
      }

      const dataTimestamp = trimmed.at(-1)?.time ?? null;
      const freshness = dataFreshness(dataTimestamp);
      recordCandleObservation({
        instrumentId: instrument.id,
        provider: provider.id,
        ok: true,
        candles: trimmed
      });
      recordMarketRequest({
        ...requestContext,
        attempted: true,
        httpStatus: 200,
        returnedCount: trimmed.length,
        droppedCount: dropped,
        durationMs: Date.now() - attemptStartedAt,
        dataTimestamp,
        freshness: freshness.classification
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
        message: error instanceof Error ? error.message : "Provider failed.",
        status: Number.isFinite(Number(error?.status)) ? Number(error.status) : null,
        reason: error?.kind ?? null,
        retryAfterSeconds: Number.isFinite(Number(error?.retryAfterSeconds)) ? Number(error.retryAfterSeconds) : null
      });
      recordMarketRequest({
        ...requestContext,
        attempted: true,
        httpStatus: error?.status ?? null,
        error: error instanceof Error ? error : new Error("Provider failed."),
        durationMs: Date.now() - attemptStartedAt
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
