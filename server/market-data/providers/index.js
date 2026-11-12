import { alphaProvider } from "./alpha.js";
import { fmpProvider } from "./fmp.js";
import { twelveProvider } from "./twelve.js";

/** Registered quote providers. Add an adapter here and nothing else changes. */
export const PROVIDERS = Object.freeze({
  fmp: fmpProvider,
  twelve: twelveProvider,
  alpha: alphaProvider
});

export const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDERS));

/** Declared capabilities. Declared, not live-verified. */
export const PROVIDER_CAPABILITIES = Object.freeze({
  fmp: {
    quotes: true,
    candles: true,
    intraday: true,
    indices: true,
    historicalIntervals: ["1day"],
    intradayIntervals: ["1min", "5min", "15min", "30min", "1h", "4h"]
  },
  twelve: {
    quotes: true,
    candles: true,
    intraday: true,
    indices: "mapped-only",
    historicalIntervals: ["1day", "1week", "1month"],
    intradayIntervals: ["1min", "5min", "15min", "30min", "1h", "4h"]
  },
  alpha: {
    quotes: true,
    candles: true,
    intraday: false,
    indices: "mapped-only",
    historicalIntervals: ["1day", "1week"],
    intradayIntervals: []
  }
});

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
