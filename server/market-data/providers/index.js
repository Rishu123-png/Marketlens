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
