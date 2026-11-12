/**
 * Market-data provider registry v2.
 *
 * This is a declaration layer, not a connectivity test. Every field says what a
 * provider claims to support, what a configured deployment may use, and what
 * has actually been observed. The distinction matters for India: an HTTP 200
 * from an unofficial endpoint is not an authorised NSE/BSE feed, and a free
 * plan that only covers US equities cannot be presented as covering NSE.
 *
 * The gateway still owns execution (order, fallback, cache, circuit, identity
 * and schema validation). This module owns the vocabulary used by diagnostics,
 * selection plans and the coverage workspace.
 */

import { resolveProviderSymbol } from "../../shared/instruments/catalog.js";

export const MARKET_DATA_REGISTRY_VERSION = "2.0.0";

const INDIA_EXCHANGES = Object.freeze(["NSE", "BSE"]);
const US_EXCHANGES = Object.freeze(["NASDAQ", "NYSE", "AMEX"]);
const ALL_EXCHANGES = Object.freeze([...INDIA_EXCHANGES, ...US_EXCHANGES]);

const REFERENCE_2026_11_12 = "2026-11-12";

/**
 * `verification` is deliberately conservative:
 * - documented: the provider's own docs/pricing page says so
 * - observed: this deployment observed the behaviour
 * - unverified: configured but not proven for this instrument/exchange
 */
export const PROVIDER_REGISTRY = Object.freeze({
  fmp: Object.freeze({
    id: "fmp",
    label: "Financial Modeling Prep",
    kind: "commercial-api",
    envName: "FMP_API_KEY",
    docs: "https://site.financialmodelingprep.com/developer/docs",
    status: "active",
    countries: Object.freeze(["US", "IN", "GLOBAL"]),
    exchanges: ALL_EXCHANGES,
    instrumentTypes: Object.freeze(["equity", "index", "etf"]),
    quote: Object.freeze({
      supported: true,
      freshness: "delayed-or-eod",
      realtime: false,
      notes: "Quote entitlement varies by plan and exchange. A 200 response is not proof of real-time data."
    }),
    candles: Object.freeze({
      daily: true,
      weekly: false,
      monthly: false,
      intraday: Object.freeze(["1min", "5min", "15min", "30min", "1h", "4h"]),
      notes: "Stable EOD endpoint is the only one used for daily candles. 4h is derived by the gateway from 1h. Intraday is plan-gated."
    }),
    intervals: Object.freeze({
      quote: Object.freeze([]),
      daily: Object.freeze(["1day"]),
      weekly: Object.freeze([]),
      monthly: Object.freeze([]),
      intraday: Object.freeze(["1min", "5min", "15min", "30min", "1h", "4h"])
    }),
    rateLimits: Object.freeze({
      freeTier: Object.freeze({ requestsPerDay: 250, requestsPerMinute: null, verification: "documented" }),
      quotaHeaders: true,
      notes: "Exact free-tier limits change; runtime quota headers/circuit state are authoritative."
    }),
    entitlement: Object.freeze({
      freeTierCoversIndia: false,
      freeTierCoversIntraday: false,
      indiaEquity: "paid-plan-or-entitled-account",
      indiaIndex: "paid-plan-or-entitled-account",
      globalEquity: "free-tier-may-work",
      realtime: "not-claimed",
      verification: "observed",
      observedAt: REFERENCE_2026_11_12,
      notes: "Production observed Premium/Restricted responses for India and intraday on the configured account."
    }),
    licensing: Object.freeze({
      display: "Provider terms; exchange display/redistribution may require a separate licence.",
      redistribution: "Not granted by a developer API key.",
      permittedUse: "internal-research-only-until-licensed",
      notes: "A paid data plan is not by itself an NSE/BSE display licence."
    }),
    health: Object.freeze({ source: "runtime", circuit: "unknown", quota: null }),
    verification: Object.freeze({ declared: true, live: false, realtime: false })
  }),

  twelve: Object.freeze({
    id: "twelve",
    label: "Twelve Data",
    kind: "commercial-api",
    envName: "TWELVE_DATA_API_KEY",
    docs: "https://twelvedata.com/docs",
    status: "active",
    countries: Object.freeze(["US", "IN", "GLOBAL"]),
    exchanges: ALL_EXCHANGES,
    instrumentTypes: Object.freeze(["equity", "index", "etf"]),
    quote: Object.freeze({
      supported: true,
      freshness: "delayed-or-eod",
      realtime: false,
      notes: "Basic free tier is US-only; India is EOD on paid plans and display needs exchange licensing."
    }),
    candles: Object.freeze({
      daily: true,
      weekly: true,
      monthly: true,
      intraday: Object.freeze(["1min", "5min", "15min", "30min", "1h", "4h"]),
      notes: "India intraday and real-time are not part of the documented Basic/Grow entitlement used here."
    }),
    intervals: Object.freeze({
      quote: Object.freeze([]),
      daily: Object.freeze(["1day"]),
      weekly: Object.freeze(["1week"]),
      monthly: Object.freeze(["1month"]),
      intraday: Object.freeze(["1min", "5min", "15min", "30min", "1h", "4h"])
    }),
    rateLimits: Object.freeze({
      freeTier: Object.freeze({ creditsPerMinute: 8, creditsPerDay: 800, verification: "documented" }),
      quotaHeaders: true,
      notes: "Credits are consumed per endpoint/symbol; runtime headers win."
    }),
    entitlement: Object.freeze({
      freeTierCoversIndia: false,
      freeTierCoversIntraday: false,
      indiaEquity: "paid-eod-plan",
      indiaIndex: "paid-eod-or-unavailable",
      globalEquity: "free-tier-us-only",
      realtime: "not-claimed",
      verification: "observed",
      observedAt: REFERENCE_2026_11_12,
      notes: "Production observed quota exhaustion at 1067/800 credits; no India data was verified."
    }),
    licensing: Object.freeze({
      display: "Exchange display licence required beyond internal use.",
      redistribution: "Not granted by the API plan.",
      permittedUse: "internal-research-only-until-licensed",
      notes: "Twelve's exchange page lists XNSE/XBOM EOD at Grow; display is a separate business-plan concern."
    }),
    health: Object.freeze({ source: "runtime", circuit: "unknown", quota: null }),
    verification: Object.freeze({ declared: true, live: false, realtime: false })
  }),

  alpha: Object.freeze({
    id: "alpha",
    label: "Alpha Vantage",
    kind: "commercial-api",
    envName: "ALPHA_VANTAGE_API_KEY",
    docs: "https://www.alphavantage.co/documentation/",
    status: "active",
    countries: Object.freeze(["US", "IN", "GLOBAL"]),
    exchanges: ALL_EXCHANGES,
    instrumentTypes: Object.freeze(["equity", "index", "etf"]),
    quote: Object.freeze({
      supported: true,
      freshness: "delayed-or-eod",
      realtime: false,
      notes: "Indian listings are addressed with .BSE; intraday and adjusted daily series are Premium."
    }),
    candles: Object.freeze({
      daily: true,
      weekly: true,
      monthly: false,
      intraday: Object.freeze([]),
      notes: "Only daily/weekly free endpoints are used. No intraday fallback is attempted."
    }),
    intervals: Object.freeze({
      quote: Object.freeze([]),
      daily: Object.freeze(["1day"]),
      weekly: Object.freeze(["1week"]),
      monthly: Object.freeze([]),
      intraday: Object.freeze([])
    }),
    rateLimits: Object.freeze({
      freeTier: Object.freeze({ requestsPerDay: 25, requestsPerMinute: 1, verification: "documented" }),
      quotaHeaders: false,
      notes: "The free key is best-effort; one request per second is a hard provider limit."
    }),
    entitlement: Object.freeze({
      freeTierCoversIndia: false,
      freeTierCoversIntraday: false,
      indiaEquity: "bse-daily-only-on-free-tier",
      indiaIndex: "unavailable-or-premium",
      globalEquity: "free-tier-may-work",
      realtime: "not-claimed",
      verification: "observed",
      observedAt: REFERENCE_2026_11_12,
      notes: "Production observed 429 rate limiting on the configured free key."
    }),
    licensing: Object.freeze({
      display: "Provider terms; exchange display/redistribution may require a separate licence.",
      redistribution: "Not granted by a developer API key.",
      permittedUse: "internal-research-only-until-licensed",
      notes: "Free tier is for development, not a production NSE/BSE display feed."
    }),
    health: Object.freeze({ source: "runtime", circuit: "unknown", quota: null }),
    verification: Object.freeze({ declared: true, live: false, realtime: false })
  }),

  yahoo: Object.freeze({
    id: "yahoo",
    label: "Yahoo Finance (unofficial endpoint)",
    kind: "unofficial-web-endpoint",
    envName: null,
    docs: "https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html",
    status: "rejected-terms",
    enabled: false,
    countries: Object.freeze(["US", "IN", "GLOBAL"]),
    exchanges: ALL_EXCHANGES,
    instrumentTypes: Object.freeze(["equity", "index", "etf"]),
    quote: Object.freeze({
      supported: false,
      freshness: "unknown",
      realtime: false,
      notes: "Not registered as a provider. Yahoo's terms prohibit automated collection without prior written permission."
    }),
    candles: Object.freeze({ daily: false, weekly: false, monthly: false, intraday: Object.freeze([]), notes: "Not used." }),
    intervals: Object.freeze({ quote: [], daily: [], weekly: [], monthly: [], intraday: [] }),
    rateLimits: Object.freeze({ freeTier: null, quotaHeaders: false, notes: "No contractual quota; absence of a quota is not permission." }),
    entitlement: Object.freeze({
      freeTierCoversIndia: false,
      freeTierCoversIntraday: false,
      indiaEquity: "not-authorised",
      indiaIndex: "not-authorised",
      globalEquity: "personal-use-only-subject-to-terms",
      realtime: "not-claimed",
      verification: "documented",
      observedAt: REFERENCE_2026_11_12,
      notes: "Yahoo Terms of Service §2.4.9 prohibits automated collection without express prior permission."
    }),
    licensing: Object.freeze({
      display: "Not granted.",
      redistribution: "Not granted.",
      permittedUse: "rejected",
      termsUrl: "https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html",
      notes: "yfinance itself states the Yahoo finance API is intended for personal use only. It remains a candidate only if written permission is obtained."
    }),
    health: Object.freeze({ source: "none", circuit: "not-applicable", quota: null }),
    verification: Object.freeze({ declared: false, live: false, realtime: false })
  })
});

export const REGISTERED_PROVIDER_IDS = Object.freeze(["fmp", "twelve", "alpha"]);
export const EVALUATED_PROVIDER_IDS = Object.freeze(Object.keys(PROVIDER_REGISTRY));

export function getProviderDescriptor(providerId) {
  return PROVIDER_REGISTRY[String(providerId || "").toLowerCase()] ?? null;
}

function configuredFor(descriptor, env) {
  if (!descriptor?.envName) return false;
  return Boolean(env?.[descriptor.envName]);
}

function healthFor(descriptor, policy) {
  const observed = policy?.providers?.[descriptor.id] ?? null;
  return {
    ...descriptor.health,
    circuit: observed?.circuit ?? (descriptor.status === "active" ? "unknown" : "not-applicable"),
    reason: observed?.reason ?? null,
    lastOutcome: observed?.lastOutcome ?? null,
    lastHttpStatus: observed?.lastHttpStatus ?? null,
    lastSuccessAt: observed?.lastSuccessAt ?? null,
    lastAttemptAt: observed?.lastAttemptAt ?? null,
    retryAfterSeconds: observed?.retryAfterSeconds ?? null,
    quota: observed?.quota ?? null
  };
}

/** Registry snapshot for diagnostics. Never includes a key or request URL. */
export function buildProviderRegistry({ env = process.env, policy = null } = {}) {
  return {
    version: MARKET_DATA_REGISTRY_VERSION,
    generatedAt: new Date().toISOString(),
    providers: Object.fromEntries(
      Object.values(PROVIDER_REGISTRY).map((descriptor) => [
        descriptor.id,
        {
          ...descriptor,
          configured: configuredFor(descriptor, env),
          health: healthFor(descriptor, policy),
          // The registry declares exchange coverage; a mapping still has to
          // exist for a specific instrument before the gateway will try it.
          registered: REGISTERED_PROVIDER_IDS.includes(descriptor.id)
        }
      ])
    ),
    hedging: [
      "No configured provider is claimed as a real-time NSE/BSE feed.",
      "A provider's declared exchange list is not an entitlement for every instrument on that exchange.",
      "Yahoo/yfinance is evaluated and rejected for automated use under Yahoo's terms; it is not registered."
    ]
  };
}

function intervalSupported(descriptor, capability, interval) {
  if (capability === "quote") return descriptor.quote?.supported === true;
  if (capability === "candles") {
    if (interval === "1day") return descriptor.candles?.daily === true;
    if (interval === "1week") return descriptor.candles?.weekly === true;
    if (interval === "1month") return descriptor.candles?.monthly === true;
    return descriptor.candles?.intraday?.includes(interval) === true;
  }
  return false;
}

/**
 * Ordered selection plan for one instrument/capability.
 *
 * It does not fetch. `selected` is the first provider the gateway would attempt;
 * every later provider is an eligible fallback. Unconfigured, unmapped,
 * unsupported and terms-rejected providers stay visible with a reason.
 */
export function providerSelectionPlan({
  instrument,
  capability = "quote",
  interval = "1day",
  order = ["fmp", "twelve", "alpha"],
  env = process.env
} = {}) {
  const providers = order
    .map((id) => getProviderDescriptor(id))
    .filter(Boolean)
    .map((descriptor) => {
      const configured = configuredFor(descriptor, env);
      const mapped = instrument ? resolveProviderSymbol(instrument, descriptor.id) !== null : false;
      const intervalOk = intervalSupported(descriptor, capability, interval);
      const active = descriptor.status === "active";
      let state = "eligible";
      let reason = null;

      if (!active) {
        state = "rejected";
        reason = "Provider is not registered for automated use.";
      } else if (!configured) {
        state = "unconfigured";
        reason = `${descriptor.envName} is not configured.`;
      } else if (!mapped) {
        state = "unsupported";
        reason = "No provider ticker is mapped for this instrument; no symbol is guessed.";
      } else if (!intervalOk) {
        state = "unsupported-interval";
        reason = `The adapter does not support ${interval} for ${capability}.`;
      }

      return {
        provider: descriptor.id,
        label: descriptor.label,
        configured,
        mapping: instrument ? resolveProviderSymbol(instrument, descriptor.id) : null,
        mapped,
        intervalSupported: intervalOk,
        state,
        reason,
        realtime: descriptor.quote?.realtime === true,
        freshness: capability === "quote" ? descriptor.quote?.freshness : descriptor.candles?.notes,
        entitlement: descriptor.entitlement,
        licensing: descriptor.licensing
      };
    });

  const selected = providers.find((provider) => provider.state === "eligible") ?? null;
  let selectedSeen = false;
  for (const provider of providers) {
    if (provider === selected) selectedSeen = true;
    provider.selected = provider === selected;
    provider.role = provider.selected ? "primary" : selectedSeen && provider.state === "eligible" ? "fallback" : "not-attempted";
  }

  return {
    version: MARKET_DATA_REGISTRY_VERSION,
    instrumentId: instrument?.id ?? null,
    symbol: instrument?.symbol ?? null,
    exchange: instrument?.exchange ?? null,
    assetType: instrument?.assetType ?? null,
    capability,
    interval,
    selected: selected?.provider ?? null,
    providers,
    note: selected
      ? "Selection is an attempt plan, not proof of data. Only a validated response becomes coverage."
      : "No configured, mapped and interval-capable provider exists for this request."
  };
}
