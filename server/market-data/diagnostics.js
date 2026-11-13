/**
 * Market-data diagnostics. Kept separate from AI diagnostics on purpose: a
 * working Groq credential says nothing about quote/candle coverage.
 *
 * No provider URL, query string, API key or key prefix appears in this payload.
 */

import { INSTRUMENTS, getInstrument, resolveProviderSymbol } from "../../shared/instruments/catalog.js";
import { buildInstrumentMatrix, instrumentAvailability, listCatalog } from "../instruments/service.js";
import { buildCoverage } from "../evidence/coverage.js";
import { observationSnapshot, marketRequestSnapshot } from "./observations.js";
import { PROVIDER_CAPABILITIES, PROVIDER_IDS, getProviderOrder, getProviders } from "./providers/index.js";
import { providerPolicySnapshot } from "./providerPolicy.js";
import { PROVIDER_REGISTRY, buildProviderRegistry, providerSelectionPlan } from "./registry.js";

const PROVIDER_KEYS = {
  fmp: "FMP_API_KEY",
  twelve: "TWELVE_DATA_API_KEY",
  alpha: "ALPHA_VANTAGE_API_KEY"
};

const CHECKED_INSTRUMENTS = ["TCS", "HINDUNILVR"];
const SELECTION_CHECKS = [
  "IN-EQ-TCS",
  "IN-EQ-TCS-BSE",
  "IN-EQ-HINDUNILVR",
  "IN-IDX-NIFTY50",
  "IN-IDX-NIFTYBANK",
  "IN-FUT-NIFTY50-FRONT",
  "IN-OPT-NIFTY50-ATM-FRONT"
];
const COVERAGE_INTERVALS = ["quote", "1min", "5min", "15min", "30min", "1h", "4h", "1day", "1week", "1month"];

function providerStatuses(env = process.env) {
  return Object.fromEntries(
    getProviders().map((provider) => [
      provider.id,
      {
        label: provider.label,
        envName: PROVIDER_KEYS[provider.id] ?? null,
        configured: Boolean(env[PROVIDER_KEYS[provider.id]]),
        capabilities: PROVIDER_CAPABILITIES[provider.id] ?? null,
        intervals: PROVIDER_CAPABILITIES[provider.id] ?? null,
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
      return [
        symbol,
        {
          found: true,
          id: instrument.id,
          exchange: instrument.exchange,
          currency: instrument.currency,
          currencyIsInstrumentMetadataOnly: true,
          providers
        }
      ];
    })
  );
}

function intervalSupport(descriptor, interval) {
  if (interval === "quote") return descriptor.quote?.supported === true;
  if (interval === "1day") return descriptor.candles?.daily === true;
  if (interval === "1week") return descriptor.candles?.weekly === true;
  if (interval === "1month") return descriptor.candles?.monthly === true;
  return descriptor.candles?.intraday?.includes(interval) === true;
}

function intervalCoverage({ env = process.env } = {}) {
  return Object.fromEntries(
    ["NSE", "BSE", "NASDAQ", "NYSE"].map((exchange) => {
      const instruments = INSTRUMENTS.filter((instrument) => instrument.exchange === exchange && instrument.assetType !== "future" && instrument.assetType !== "option");
      return [
        exchange,
        Object.fromEntries(
          COVERAGE_INTERVALS.map((interval) => {
            const declared = PROVIDER_IDS.filter((id) => {
              const descriptor = PROVIDER_REGISTRY[id];
              return descriptor.exchanges.includes(exchange) && intervalSupport(descriptor, interval);
            });
            const configured = declared.filter((id) => Boolean(env[PROVIDER_REGISTRY[id].envName]));
            return [
              interval,
              {
                catalogued: instruments.length,
                declaredProviders: declared,
                configuredProviders: configured,
                // Declared support is not a validated response and is never
                // counted as coverage.
                verifiedInstruments: 0,
                status: configured.length ? "configured-unverified" : declared.length ? "declared-not-configured" : "unavailable"
              }
            ];
          })
        )
      ];
    })
  );
}

export function buildMarketDiagnostics({ env = process.env, now = () => new Date() } = {}) {
  const matrix = buildInstrumentMatrix({ now });
  const policy = providerPolicySnapshot({ now: now().getTime() });
  const registry = buildProviderRegistry({ env, policy });
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
    // HTTP success means the provider answered. Verified means the response
    // passed identity/schema checks and was stored as an observation. They are
    // deliberately separate numbers.
    quoteHttpSuccesses: entries.filter((entry) => entry.kind === "quote" && entry.httpStatus === 200).length,
    candleHttpSuccesses: entries.filter((entry) => entry.kind === "candles" && entry.httpStatus === 200).length,
    verifiedQuoteSuccesses: observed.quotes.verified,
    candleSuccesses: observed.candles.withCandles,
    failures: entries.filter((entry) => entry.error).length,
    realtimeClaims: 0
  };

  return {
    generatedAt: now().toISOString(),
    separation:
      "Market-data connectivity is independent of Groq connectivity. Quotes and candles never use Groq, and AI readiness never implies price coverage.",
    providers: providerStatuses(env),
    providerOrder: getProviderOrder(),
    providerPolicy: policy,
    registry,
    intervalCoverage: intervalCoverage({ env }),
    providerSelection: Object.fromEntries(
      SELECTION_CHECKS.map((id) => {
        const instrument = getInstrument(id);
        return [
          id,
          instrument
            ? {
                instrument: {
                  symbol: instrument.symbol,
                  name: instrument.name,
                  exchange: instrument.exchange,
                  assetType: instrument.assetType
                },
                quote: providerSelectionPlan({ instrument, capability: "quote", env }),
                dailyCandles: providerSelectionPlan({ instrument, capability: "candles", interval: "1day", env })
              }
            : { error: "not catalogued" }
        ];
      })
    ),
    instrumentCoverage: matrix.coverage,
    instrumentMatrix: listCatalog(),
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
      quoteHttpSuccesses: "A provider returned HTTP 2xx. Identity/schema validation may still reject it.",
      verifiedQuoteSuccesses: "Instruments whose latest quote observation passed identity/schema checks in this instance.",
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
      "No request URL or credential value is recorded.",
      "Registry exchanges/intervals are declarations. Only identity-checked observations count as verified coverage.",
      "Yahoo/yfinance is listed as evaluated-but-rejected, not as a configured provider."
    ]
  };
}
