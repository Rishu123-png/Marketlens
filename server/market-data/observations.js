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
const quotes = new Map();
const candles = new Map();

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
}

/** Raw quote observation rows, for coverage aggregation. */
export function quoteObservationRows() {
  return [...quotes.values()];
}
