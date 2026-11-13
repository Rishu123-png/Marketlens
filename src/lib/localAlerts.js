import { numberOrNull, quoteState } from "./marketVisuals.js";
import { formatMoney, formatPercent } from "./api.js";

/** Alerts evaluate only fresh-enough, provider-verified observations locally. */
export function evaluateLocalAlert(alert, quote, now = Date.now()) {
  if (!quote || quote.mode !== "verified" || quote.quoteVerified !== true) return null;
  const state = quoteState(quote, now);
  if (!["live", "delayed"].includes(state.code)) return null;
  const threshold = numberOrNull(alert.threshold);
  const price = numberOrNull(quote.price);
  const change = numberOrNull(quote.changePercent);
  if (threshold === null) return null;
  if (alert.type === "priceAbove" && price !== null && price > threshold) return `Price ${formatMoney(price, quote.currency)} above ${threshold}`;
  if (alert.type === "priceBelow" && price !== null && price < threshold) return `Price ${formatMoney(price, quote.currency)} below ${threshold}`;
  if (alert.type === "changeAbove" && change !== null && change > threshold) return `Change ${formatPercent(change)} above ${threshold}%`;
  if (alert.type === "changeBelow" && change !== null && change < threshold) return `Change ${formatPercent(change)} below ${threshold}%`;
  return null;
}
