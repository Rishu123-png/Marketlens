import { numberOrNull, quoteState } from "./marketVisuals.js";

export const TICKER_MOVER_LIMIT = 10;
const SCROLL_SPEED = 36; // pixels per second

/** Advance by one frame and wrap at the start of the identical visual repeat. */
export function advanceTicker(position, elapsedMs, sequenceWidth) {
  if (!(sequenceWidth > 0)) return position;
  // Limit the step when a background tab or a busy frame resumes.
  const elapsed = Math.max(0, Math.min(elapsedMs, 100)) / 1000;
  return (position + elapsed * SCROLL_SPEED) % sequenceWidth;
}

/**
 * The overview's rows are verified by its gateway contract. Keep only usable
 * prices and changes, and preserve the ranking even if an older response is
 * unordered. A shorter list is intentional when fewer stocks qualify.
 */
export function selectTickerMovers(overview) {
  function ranked(entries, direction) {
    if (!Array.isArray(entries)) return [];
    return entries
      .filter((entry) => {
        const change = numberOrNull(entry?.quote?.changePercent);
        return change !== null && change * direction > 0 &&
          quoteState(entry?.quote, undefined, { verifiedByContract: true }).code !== "unavailable";
      })
      .sort((a, b) => direction * (Number(b.quote.changePercent) - Number(a.quote.changePercent)))
      .slice(0, TICKER_MOVER_LIMIT);
  }

  return {
    gainers: ranked(overview?.gainers, 1),
    losers: ranked(overview?.losers, -1)
  };
}
