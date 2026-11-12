/**
 * Instrument master service.
 *
 * Owns the merge between the bundled catalogue and any provider directory, the
 * per-instrument provider availability view, and the coverage matrix. Every
 * label is derived from configuration plus observed calls; nothing here implies
 * that a catalogued instrument has a live quote.
 */

import {
  INSTRUMENTS,
  getInstrument,
  instrumentFromSymbol,
  resolveProviderSymbol
} from "../../shared/instruments/catalog.js";
import { getProviders } from "../market-data/providers/index.js";
import { candleObservation, observationSnapshot, quoteObservation, quoteObservationRows } from "../market-data/observations.js";
import { directoryStatus, getDirectory } from "./directory.js";

export const INSTRUMENT_SERVICE_VERSION = "1.0.0";
const FRESH_MS = 15 * 60 * 1000;

export const ASSET_TYPES = Object.freeze(["equity", "index", "etf", "mutualfund", "future", "option"]);
export const EXCHANGES = Object.freeze(["NSE", "BSE", "NASDAQ", "NYSE", "AMEX", "INDEX"]);

/** Configured providers and what each can do for this instrument. */
export function instrumentAvailability(instrument, { interval = "1day" } = {}) {
  const providers = getProviders();
  const mapped = providers.filter((provider) => provider.supports?.(instrument));
  const configured = mapped.filter((provider) => provider.isConfigured?.());
  const quoteCapable = mapped.filter((provider) => typeof provider.fetchQuote === "function");
  const candleCapable = mapped.filter(
    (provider) =>
      typeof provider.fetchCandles === "function" &&
      (typeof provider.supportsCandleInterval !== "function" || provider.supportsCandleInterval(interval))
  );

  const quoteProviders = configured
    .filter((provider) => typeof provider.fetchQuote === "function")
    .map((provider) => provider.id);
  const candleProviders = configured
    .filter(
      (provider) =>
        typeof provider.fetchCandles === "function" &&
        (typeof provider.supportsCandleInterval !== "function" || provider.supportsCandleInterval(interval))
    )
    .map((provider) => provider.id);

  return {
    mappedProviders: mapped.map((provider) => provider.id),
    configuredProviders: configured.map((provider) => provider.id),
    // "supported" = adapter/mapping capability, independent of an API key.
    quoteSupported: quoteCapable.length > 0,
    candleSupported: candleCapable.length > 0,
    quoteMappedProviders: quoteCapable.map((provider) => provider.id),
    candleMappedProviders: candleCapable.map((provider) => provider.id),
    // "enabled" = a configured key exists for a mapped capability.
    quoteProviders,
    candleProviders,
    unavailableFromAllConfigured: quoteProviders.length === 0 && candleProviders.length === 0,
    providerSymbols: Object.fromEntries(
      mapped.map((provider) => [provider.id, resolveProviderSymbol(instrument, provider.id)])
    )
  };
}

function observedQuoteSummary(instrument) {
  const observation = quoteObservation(instrument.id);
  const fresh =
    Boolean(observation?.verified && observation.lastSuccessAt) &&
    Date.now() - Date.parse(observation.lastSuccessAt) <= FRESH_MS;
  return {
    verified: Boolean(observation?.verified && fresh),
    lastAttemptAt: observation?.lastAttemptAt ?? null,
    lastSuccessAt: observation?.lastSuccessAt ?? null,
    lastError: observation?.lastError ?? null,
    provider: observation?.lastProvider ?? null
  };
}

export function publicInstrument(instrument, { availability = instrumentAvailability(instrument) } = {}) {
  const quote = observedQuoteSummary(instrument);
  const candle = candleObservation(instrument.id);
  return {
    id: instrument.id,
    symbol: instrument.symbol,
    name: instrument.name,
    exchange: instrument.exchange,
    country: instrument.country,
    currency: instrument.currency,
    assetType: instrument.assetType,
    sector: instrument.sector,
    underlyingId: instrument.underlyingId ?? null,
    contractTemplate: instrument.contractTemplate ?? null,
    expiry: instrument.expiry ?? null,
    strike: instrument.strike ?? null,
    optionType: instrument.optionType ?? null,
    lotSize: instrument.lotSize ?? null,
    lotSizeStatus: instrument.lotSizeStatus ?? null,
    source: instrument.source ?? "catalog",
    availability: {
      ...availability,
      quoteEnabled: availability.quoteProviders.length > 0,
      candleEnabled: availability.candleProviders.length > 0,
      providerSymbols: availability.providerSymbols ?? {},
      unavailableFromAllConfigured:
        availability.quoteProviders.length === 0 && availability.candleProviders.length === 0,
      quoteVerifiedRecently: quote.verified,
      lastQuoteAt: quote.lastSuccessAt,
      lastCandleAt: candle?.lastSuccessAt ?? null,
      lastCandleCount: candle?.candleCount ?? 0
    }
  };
}

function filterMatch(instrument, filters = {}) {
  const currency = filters.currency ? String(filters.currency).toUpperCase() : "";
  if (currency && instrument.currency !== currency) return false;
  for (const key of ["country", "exchange", "assetType", "sector"]) {
    const wanted = filters[key];
    const values = (Array.isArray(wanted) ? wanted : [wanted]).filter(Boolean).map((value) => String(value).toUpperCase());
    if (!values.length) continue;
    if (!values.includes(String(instrument[key]).toUpperCase())) return false;
  }
  return true;
}

function scoreInstrument(instrument, needle) {
  const symbol = instrument.symbol.replace(/^\^/, "").toUpperCase();
  const name = instrument.name.toUpperCase();
  const exchange = instrument.exchange.toUpperCase();
  const type = instrument.assetType.toUpperCase();

  if (symbol === needle) return 100;
  if (symbol.startsWith(needle)) return 85;
  if (name.startsWith(needle)) return 70;
  if (name.includes(needle)) return 50;
  if (symbol.includes(needle)) return 40;
  if (exchange === needle) return 25;
  if (type === needle) return 20;
  if (instrument.sector.toUpperCase().includes(needle)) return 10;
  return -1;
}

function directoryForSearch(directory) {
  const known = new Set(INSTRUMENTS.map((instrument) => `${instrument.symbol}|${instrument.exchange}`));
  return directory.instruments.filter((instrument) => !known.has(`${instrument.symbol}|${instrument.exchange}`));
}

/**
 * Search the bundled catalogue and (optionally) the provider directory.
 * `total` is the full match count before pagination.
 */
export async function searchInstrumentMaster(query, filters = {}, { limit = 50, offset = 0, includeDirectory = true } = {}) {
  const needle = String(query || "").trim().toUpperCase();
  const directory = includeDirectory ? await getDirectory() : { instruments: [], status: directoryStatus() };
  const pool = [...INSTRUMENTS, ...directoryForSearch(directory)];

  const matched = [];
  for (const instrument of pool) {
    if (!filterMatch(instrument, filters)) continue;
    if (!needle) {
      matched.push({ instrument, score: 0 });
      continue;
    }
    const score = scoreInstrument(instrument, needle);
    if (score >= 0) matched.push({ instrument, score });
  }

  if (needle) {
    matched.sort(
      (a, b) =>
        b.score - a.score ||
        a.instrument.symbol.localeCompare(b.instrument.symbol) ||
        a.instrument.exchange.localeCompare(b.instrument.exchange)
    );
  }

  const page = matched.slice(offset, offset + limit).map(({ instrument }) => publicInstrument(instrument));

  return {
    query: needle || null,
    filters,
    total: matched.length,
    catalogSize: INSTRUMENTS.length,
    directory: directory.status,
    offset,
    limit,
    count: page.length,
    instruments: page
  };
}

export function resolveInstrumentTarget(target, exchange, { directory = [] } = {}) {
  if (target && typeof target === "object") return target;
  const value = String(target || "").trim();
  if (!value) return null;
  const known = getInstrument(value);
  if (known) return known;
  const match = directory.find(
    (instrument) => instrument.symbol === value.toUpperCase() && (!exchange || instrument.exchange === String(exchange).toUpperCase())
  );
  return match || instrumentFromSymbol(value, exchange);
}

/**
 * Data-coverage matrix.
 *
 * Directory data is only read from cache here: a coverage request must not wait
 * on (or trigger) a provider download. Use `/api/instruments?refreshDirectory=1`
 * to populate it explicitly.
 */
export function buildInstrumentMatrix({ now = () => new Date() } = {}) {
  const generatedAt = now().toISOString();
  const directory = directoryStatus();
  const quoteRows = quoteObservationRows();
  const snapshot = observationSnapshot();
  const freshCutoff = Date.parse(generatedAt) - FRESH_MS;

  const rows = INSTRUMENTS.map((instrument) => {
    const availability = instrumentAvailability(instrument);
    const observed = quoteObservation(instrument.id);
    const candle = candleObservation(instrument.id);
    return {
      instrument,
      availability,
      quoteObserved: Boolean(observed?.verified && observed.lastSuccessAt && Date.parse(observed.lastSuccessAt) >= freshCutoff),
      candleObserved: Boolean(candle?.lastSuccessAt && Date.parse(candle.lastSuccessAt) >= freshCutoff && (candle.candleCount ?? 0) > 0),
      failure: observed?.lastError ?? null,
      candleFailure: candle?.lastError ?? null
    };
  });

  const count = (predicate) => rows.filter(predicate).length;
  const supported = count((row) => row.availability.mappedProviders.length > 0);
  const quoteEnabled = count((row) => row.availability.quoteProviders.length > 0);
  const candleEnabled = count((row) => row.availability.candleProviders.length > 0);
  const quoteSupported = count((row) => row.availability.quoteSupported);
  const candleSupported = count((row) => row.availability.candleSupported);
  const unavailableFromAllConfigured = count((row) => row.availability.unavailableFromAllConfigured);
  const verified = count((row) => row.quoteObserved);
  const candlesVerified = count((row) => row.candleObserved);

  const failuresByProvider = {};
  for (const row of quoteRows) {
    if (!row.lastError) continue;
    const key = row.lastProvider || "unknown";
    failuresByProvider[key] = failuresByProvider[key] ?? { provider: key, failures: 0, example: row.lastError };
    failuresByProvider[key].failures += 1;
  }

  return {
    version: INSTRUMENT_SERVICE_VERSION,
    generatedAt,
    catalogued: INSTRUMENTS.length,
    directory: {
      ...directory,
      mergedSize: INSTRUMENTS.length + directory.count
    },
    coverage: {
      // Six deliberately separate counts. "Supported" is a capability/mapping
      // claim; "verified" requires an observed, identity-checked response.
      catalogued: INSTRUMENTS.length,
      providerMapped: supported,
      quoteSupported,
      quoteEnabled,
      quoteNotEnabled: INSTRUMENTS.length - quoteEnabled,
      verifiedLatestQuote: verified,
      candleSupported,
      candleEnabled,
      verifiedHistoricalCandles: candlesVerified,
      candleObserved: snapshot.candles.withCandles,
      unavailableFromAllConfigured,
      newsQueryable: INSTRUMENTS.length,
      realtime: 0
    },
    freshness: {
      classification: "delayed",
      detail:
        "Configured quote vendors' free/developer tiers are delayed or end-of-day and are not exchange-licensed real-time feeds. No instrument is labelled real-time.",
      lastSuccessfulQuoteAt: snapshot.quotes.lastSuccessAt,
      lastSuccessfulCandleAt: snapshot.candles.lastSuccessAt,
      observationWindowMinutes: snapshot.freshnessWindowMinutes
    },
    runtime: snapshot,
    providerFailures: Object.values(failuresByProvider),
    byExchange: Object.fromEntries(
      [...new Set(INSTRUMENTS.map((instrument) => instrument.exchange))].sort().map((exchange) => [
        exchange,
        {
          catalogued: INSTRUMENTS.filter((instrument) => instrument.exchange === exchange).length,
          quoteSupported: count((row) => row.instrument.exchange === exchange && row.availability.quoteSupported),
          quoteEnabled: count((row) => row.instrument.exchange === exchange && row.availability.quoteProviders.length > 0),
          verified: count((row) => row.instrument.exchange === exchange && row.quoteObserved),
          candleSupported: count((row) => row.instrument.exchange === exchange && row.availability.candleSupported),
          verifiedCandles: count((row) => row.instrument.exchange === exchange && row.candleObserved)
        }
      ])
    ),
    honesty: {
      cataloguedDoesNotMeanQuoted: true,
      verifiedMeansObservedInThisInstance: true,
      observationPersistence: "per-instance; resets on cold start",
      supportedIsNotVerified: true,
      note: "Supported/Enabled are mapping and configuration claims. Verified counts only recent successful, identity-checked observations in this instance. Unavailable means no configured provider maps a quote or candle capability."
    }
  };
}

export function listCatalog() {
  return INSTRUMENTS.map((instrument) => publicInstrument(instrument));
}

export { INSTRUMENTS };
