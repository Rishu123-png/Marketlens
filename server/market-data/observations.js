/**
 * Runtime market-data observations.
 *
 * A provider being configured is not evidence that it can quote a particular
 * instrument. The gateway and candle service record what actually happened for
 * each instrument, and the coverage matrix reports that instead of inferring
 * success from configuration.
 *
 * The store is per serverless instance and deliberately small and bounded: it
 * is operational telemetry, not a durable market-data history. `persisted:false`
 * is surfaced in every API response that uses it.
 */

const MAX_ENTRIES = 2_000;
const MAX_REQUESTS = 400;
const quotes = new Map();
const candles = new Map();
const requests = [];

function boundedSet(store, key, value) {
  store.set(key, value);
  if (store.size > MAX_ENTRIES) {
    const oldest = [...store.entries()]
      .sort((a, b) => String(a[1].lastAttemptAt).localeCompare(String(b[1].lastAttemptAt)))
      .slice(0, store.size - MAX_ENTRIES);
    for (const [stale] of oldest) store.delete(stale);
  }
}

function messageOf(error) {
  if (!error) return null;
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

export function recordQuoteObservation({ instrumentId, provider, ok, error = null, quote = null }) {
  if (!instrumentId) return;
  const now = new Date().toISOString();
  const previous = quotes.get(instrumentId) || {};
  boundedSet(quotes, instrumentId, {
    ...previous,
    instrumentId,
    lastAttemptAt: now,
    lastSuccessAt: ok ? now : previous.lastSuccessAt ?? null,
    lastFailureAt: ok ? previous.lastFailureAt ?? null : now,
    lastProvider: provider ?? previous.lastProvider ?? null,
    lastError: ok ? null : messageOf(error),
    verified: Boolean(ok),
    livePrice: ok ? quote?.price ?? null : previous.livePrice ?? null,
    currency: ok ? quote?.currency ?? previous.currency ?? null : previous.currency ?? null,
    providerTimestamp: ok ? quote?.providerTimestamp ?? null : previous.providerTimestamp ?? null
  });
}

export function recordCandleObservation({ instrumentId, provider, ok, error = null, candles: rows = null }) {
  if (!instrumentId) return;
  const now = new Date().toISOString();
  const previous = candles.get(instrumentId) || {};
  boundedSet(candles, instrumentId, {
    ...previous,
    instrumentId,
    lastAttemptAt: now,
    lastSuccessAt: ok ? now : previous.lastSuccessAt ?? null,
    lastFailureAt: ok ? previous.lastFailureAt ?? null : now,
    lastProvider: provider ?? previous.lastProvider ?? null,
    lastError: ok ? null : messageOf(error),
    candleCount: ok ? rows?.length ?? 0 : previous.candleCount ?? 0
  });
}

export function quoteObservation(instrumentId) {
  return quotes.get(instrumentId) || null;
}

export function candleObservation(instrumentId) {
  return candles.get(instrumentId) || null;
}

/**
 * Safe per-request market-data telemetry. Never include provider URLs, query
 * strings or API keys: `providerRequestUrl` is deliberately absent.
 */
function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function recordMarketRequest(entry = {}) {
  const event = {
    at: new Date().toISOString(),
    kind: entry.kind === "candles" ? "candles" : "quote",
    instrumentId: entry.instrumentId ?? null,
    symbol: entry.symbol ?? null,
    exchange: entry.exchange ?? null,
    interval: entry.interval ?? null,
    requestedLimit: numberOrNull(entry.requestedLimit),
    provider: entry.provider ?? null,
    attempted: entry.attempted === true,
    httpStatus: numberOrNull(entry.httpStatus),
    error: entry.error ? messageOf(entry.error) : null,
    returnedCount: numberOrNull(entry.returnedCount) ?? 0,
    droppedCount: numberOrNull(entry.droppedCount) ?? 0,
    cacheHit: entry.cacheHit === true,
    durationMs: numberOrNull(entry.durationMs) === null ? null : Math.max(0, numberOrNull(entry.durationMs)),
    dataTimestamp: entry.dataTimestamp ?? null,
    freshness: entry.freshness ?? null
  };
  requests.push(event);
  if (requests.length > MAX_REQUESTS) requests.splice(0, requests.length - MAX_REQUESTS);
  return event;
}

/** Age-based label for a provider timestamp. Missing timestamps are unknown. */
export function dataFreshness(dataTimestamp, { now = Date.now() } = {}) {
  if (!dataTimestamp) return { ageMinutes: null, classification: "unknown" };
  const parsed = Date.parse(dataTimestamp);
  if (!Number.isFinite(parsed)) return { ageMinutes: null, classification: "unknown" };
  const ageMinutes = Math.max(0, Math.round((now - parsed) / 60_000));
  const classification =
    ageMinutes <= 15 ? "fresh" : ageMinutes <= 24 * 60 ? "delayed" : "eod-or-historical";
  return { ageMinutes, classification };
}

export function marketRequestSnapshot({ kind = null, limit = 100 } = {}) {
  const selected = kind ? requests.filter((entry) => entry.kind === kind) : requests;
  return {
    persisted: false,
    note: "Per-process request telemetry; resets on cold start. Contains no URLs or credentials.",
    count: selected.length,
    entries: selected.slice(-Math.max(1, Math.min(200, Number(limit) || 100))).reverse()
  };
}

export function observationSnapshot({ now = Date.now(), freshMs = 15 * 60 * 1000 } = {}) {
  const recent = (value) => Boolean(value) && now - Date.parse(value) <= freshMs;
  const quoteRows = [...quotes.values()];
  const candleRows = [...candles.values()];

  return {
    persisted: false,
    note: "Observations are per serverless instance and reset on cold start.",
    freshnessWindowMinutes: Math.round(freshMs / 60_000),
    quotes: {
      instrumentsObserved: quoteRows.length,
      verified: quoteRows.filter((row) => row.verified).length,
      verifiedFresh: quoteRows.filter((row) => row.verified && recent(row.lastSuccessAt)).length,
      failed: quoteRows.filter((row) => row.lastError).length,
      lastSuccessAt: quoteRows.map((row) => row.lastSuccessAt).filter(Boolean).sort().at(-1) ?? null
    },
    candles: {
      instrumentsObserved: candleRows.length,
      withCandles: candleRows.filter((row) => row.candleCount > 0).length,
      failed: candleRows.filter((row) => row.lastError).length,
      lastSuccessAt: candleRows.map((row) => row.lastSuccessAt).filter(Boolean).sort().at(-1) ?? null
    },
    recentQuoteIds: quoteRows.filter((row) => row.verified && recent(row.lastSuccessAt)).map((row) => row.instrumentId)
  };
}

export function resetObservationsForTests() {
  quotes.clear();
  candles.clear();
  requests.length = 0;
}

/** Raw quote observation rows, for coverage aggregation. */
export function quoteObservationRows() {
  return [...quotes.values()];
}
