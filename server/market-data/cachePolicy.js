/** Cache lifetimes chosen by data cadence, never by wall-clock convenience. */
export const QUOTE_CACHE_TTL_MS = 60_000;

export function candleCacheTtlMs(interval) {
  if (["1min", "5min", "15min", "30min"].includes(interval)) return 60_000;
  if (interval === "1h" || interval === "4h") return 5 * 60_000;
  if (interval === "1week" || interval === "1month") return 60 * 60_000;
  return 15 * 60_000;
}
