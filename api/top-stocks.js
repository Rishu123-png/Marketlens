import { getInstrument, POPULAR_INDIAN_EQUITY_IDS } from "../shared/instruments/catalog.js";
import { getVerifiedQuote, mapConcurrent } from "../server/market-data/gateway.js";
import { rateLimit } from "../lib/server/rateLimit.js";

const CACHE_TTL_MS = 5 * 60 * 1000;

// Bounded concurrency instead of a fixed 250 ms pause per symbol: the same
// provider calls finish in a fraction of the time and stay inside maxDuration.
const CONCURRENCY = 4;

let cachedData = null;
let cacheCreatedAt = 0;

function calculateScore(stock) {
  const changePercent = Number(stock.changePercent);

  if (
    stock.changePercent === null ||
    stock.changePercent === undefined ||
    stock.changePercent === "" ||
    !Number.isFinite(changePercent)
  ) {
    return null;
  }

  const range =
    stock.dayHigh !== null && stock.dayLow !== null && stock.price > 0
      ? ((stock.dayHigh - stock.dayLow) / stock.price) * 100
      : null;

  let score = changePercent * 10;

  if (range !== null && Number.isFinite(range)) {
    score += Math.min(range, 10) * 0.25;
  }

  if (stock.volume !== null && stock.volume > 0) {
    score += 1;
  }

  return Number(score.toFixed(3));
}

export default async function handler(req, res) {
  const quota = await rateLimit(req, {
    name: "top-stocks",
    limit: 30,
    windowMs: 60_000
  });

  if (!quota.allowed) {
    res.setHeader?.("Retry-After", String(quota.retryAfterSeconds));
    return res.status(429).json({
      error: "Too many market-summary requests. Please try again shortly.",
      retryAfterSeconds: quota.retryAfterSeconds
    });
  }

  if (cachedData && Date.now() - cacheCreatedAt < CACHE_TTL_MS) {
    return res.status(200).json({ ...cachedData, cached: true });
  }

  const universe = POPULAR_INDIAN_EQUITY_IDS.map(getInstrument).filter(Boolean);

  const verified = (
    await mapConcurrent(universe, CONCURRENCY, async (instrument) => {
      try {
        const quote = await getVerifiedQuote(instrument);
        const score = calculateScore(quote);
        return score === null ? null : { ...quote, score };
      } catch {
        // Failed quotes are intentionally excluded. No demo replacement data.
        return null;
      }
    })
  ).filter(Boolean);

  const ranked = verified.sort((a, b) => b.score - a.score);

  if (!ranked.length) {
    return res.status(503).json({
      error: "No verified stocks could be ranked with the currently configured providers."
    });
  }

  const response = {
    generatedAt: new Date().toISOString(),
    marketStatus: "Popular Indian stocks with successfully verified provider quotes.",
    universeSize: universe.length,
    verifiedCount: ranked.length,
    stocks: ranked
  };

  cachedData = response;
  cacheCreatedAt = Date.now();

  return res.status(200).json(response);
}
