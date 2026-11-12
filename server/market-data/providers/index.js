import { alphaProvider } from "./alpha.js";
import { fmpProvider } from "./fmp.js";
import { twelveProvider } from "./twelve.js";
import { getProviderDescriptor } from "../registry.js";

/** Registered quote providers. Add an adapter here and nothing else changes. */
export const PROVIDERS = Object.freeze({
  fmp: fmpProvider,
  twelve: twelveProvider,
  alpha: alphaProvider
});

export const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDERS));

/** Declared capabilities. Declared, not live-verified. */
function capabilitiesFor(id) {
  const descriptor = getProviderDescriptor(id);
  return {
    // Legacy flat flags stay for existing consumers.
    quotes: descriptor.quote.supported,
    candles: descriptor.candles.daily,
    intraday: descriptor.candles.intraday.length > 0,
    indices: id === "fmp" ? true : "mapped-only",
    historicalIntervals: ["1day", "1week", "1month"].filter((interval) =>
      interval === "1day" ? descriptor.candles.daily : descriptor.candles[interval === "1week" ? "weekly" : "monthly"]
    ),
    intradayIntervals: [...descriptor.candles.intraday],
    // Registry v2 vocabulary: exchanges, instrument types, freshness and
    // licensing are declarations, never live-coverage claims.
    exchanges: [...descriptor.exchanges],
    instrumentTypes: [...descriptor.instrumentTypes],
    quoteFreshness: descriptor.quote.freshness,
    realtime: descriptor.quote.realtime,
    entitlement: descriptor.entitlement,
    licensing: descriptor.licensing,
    rateLimits: descriptor.rateLimits,
    verification: descriptor.verification
  };
}

export const PROVIDER_CAPABILITIES = Object.freeze(
  Object.fromEntries(PROVIDER_IDS.map((id) => [id, Object.freeze(capabilitiesFor(id))]))
);

/**
 * Provider attempt order. `PRIMARY_MARKET_PROVIDER` (fmp | twelve | alpha)
 * chooses which one is tried first; unknown values fall back to fmp.
 */
export function getProviderOrder(primary = process.env.PRIMARY_MARKET_PROVIDER) {
  const wanted = String(primary || "fmp").toLowerCase();
  const first = PROVIDER_IDS.includes(wanted) ? wanted : "fmp";
  return [first, ...PROVIDER_IDS.filter((id) => id !== first)];
}

export function getProviders(order = getProviderOrder()) {
  return order.map((id) => PROVIDERS[id]).filter(Boolean);
}

export { alphaProvider, fmpProvider, twelveProvider };
