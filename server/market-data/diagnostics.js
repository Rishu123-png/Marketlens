/**
 * Market-data diagnostics. Kept separate from AI diagnostics on purpose: a
 * working Groq credential says nothing about quote/candle coverage.
 *
 * No provider URL, query string, API key or key prefix appears in this payload.
 */

import { getInstrument, resolveProviderSymbol } from "../../shared/instruments/catalog.js";
import { buildInstrumentMatrix, instrumentAvailability } from "../instruments/service.js";
import { buildCoverage } from "../evidence/coverage.js";
import { observationSnapshot, marketRequestSnapshot } from "./observations.js";
import { PROVIDER_CAPABILITIES, PROVIDER_IDS, getProviders } from "./providers/index.js";

const PROVIDER_KEYS = {
  fmp: "FMP_API_KEY",
  twelve: "TWELVE_DATA_API_KEY",
  alpha: "ALPHA_VANTAGE_API_KEY"
};

const CHECKED_INSTRUMENTS = ["TCS", "HINDUNILVR"];

function providerStatuses(env = process.env) {
  return Object.fromEntries(
    getProviders().map((provider) => [
      provider.id,
      {
        label: provider.label,
        envName: PROVIDER_KEYS[provider.id] ?? null,
        configured: Boolean(env[PROVIDER_KEYS[provider.id]]),
        capabilities: PROVIDER_CAPABILITIES[provider.id] ?? null,
        verification: env[PROVIDER_KEYS[provider.id]] ? "configured-unverified" : "not-configured",
        liveVerified: false
      }
    ])
  );
}

function instrumentMappings() {
  return Object.fromEntries(
    CHECKED_INSTRUMENTS.map((symbol) => {
      const instrument = getInstrument(`IN-EQ-${symbol}`);
      if (!instrument) return [symbol, { found: false }];
      const providers = Object.fromEntries(
        PROVIDER_IDS.map((provider) => [
          provider,
          {
            mapped: resolveProviderSymbol(instrument, provider) !== null,
            // The provider ticker itself is safe: it identifies a public listing,
            // not a credential. It is included so a wrong .NS/.BO mapping is
            // visible without exposing keys.
            ticker: resolveProviderSymbol(instrument, provider)
          }
        ])
      );
      return [symbol, { found: true, id: instrument.id, exchange: instrument.exchange, currency: instrument.currency, providers }];
    })
  );
}

export function buildMarketDiagnostics({ env = process.env, now = () => new Date() } = {}) {
  const matrix = buildInstrumentMatrix({ now });
  const coverage = buildCoverage({ env, now });
  const observed = observationSnapshot({ now: now().getTime() });
  const requests = marketRequestSnapshot({ limit: 120 });
  const entries = requests.entries;
  const states = {
    configuredProviders: Object.values(providerStatuses(env)).filter((provider) => provider.configured).length,
    requestAttempted: entries.filter((entry) => entry.attempted).length,
    requestSucceeded: entries.filter((entry) => entry.attempted && entry.httpStatus === 200).length,
    notSent: entries.filter((entry) => !entry.attempted).length,
    cacheHits: entries.filter((entry) => entry.cacheHit).length,
    verifiedQuoteSuccesses: entries.filter((entry) => entry.kind === "quote" && entry.httpStatus === 200).length,
    candleSuccesses: entries.filter((entry) => entry.kind === "candles" && entry.httpStatus === 200).length,
    failures: entries.filter((entry) => entry.error).length,
    realtimeClaims: 0
  };

  return {
    generatedAt: now().toISOString(),
    separation:
      "Market-data connectivity is independent of Groq connectivity. Quotes and candles never use Groq, and AI readiness never implies price coverage.",
    providers: providerStatuses(env),
    providerOrder: PROVIDER_IDS,
    instrumentCoverage: matrix.coverage,
    freshness: matrix.freshness,
    byExchange: matrix.byExchange,
    directory: matrix.directory,
    observations: observed,
    requestStates: states,
    stateGlossary: {
      configured: "Environment variable exists. No entitlement, quota or symbol coverage is implied.",
      supported: "The adapter has a provider ticker mapping for this instrument.",
      requestAttempted: "A provider call was actually made.",
      requestSucceeded: "The provider returned a 2xx response.",
      dataVerified: "The response passed identity and schema validation and is shown as a quote/candle.",
      cached: "Served from the in-process cache; not a fresh provider call.",
      delayed: "Provider tier is delayed or end-of-day; no real-time entitlement is claimed.",
      unavailable: "No configured provider returned usable data; nothing is fabricated."
    },
    recentRequests: requests,
    capabilityCoverage: coverage.capabilities,
    mappingChecks: instrumentMappings(),
    tcsAvailability: instrumentAvailability(getInstrument("IN-EQ-TCS")),
    hindunilvrAvailability: instrumentAvailability(getInstrument("IN-EQ-HINDUNILVR")),
    limitations: [
      "Configured means an environment variable exists; it does not prove entitlement, quota or symbol coverage.",
      "Request diagnostics are per serverless instance and reset on cold start.",
      "Quote and candle observations record only attempts made by this instance; cached responses are marked as cache hits.",
      "No request URL or credential value is recorded."
    ]
  };
}
