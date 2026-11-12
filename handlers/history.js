// Historical candles. Provider access, normalization, validation and caching
// live in server/market-data/candles.js; this handler is the HTTP contract.
import { getCandles, INTERVALS } from "../server/market-data/candles.js";
import { rateLimit } from "../lib/server/rateLimit.js";

export default async function handler(req, res) {
  const quota = await rateLimit(req, { name: "history", limit: 60, windowMs: 60_000 });
  if (!quota.allowed) {
    res.setHeader?.("Retry-After", String(quota.retryAfterSeconds));
    return res.status(429).json({
      error: "Too many candle requests. Please try again shortly.",
      retryAfterSeconds: quota.retryAfterSeconds
    });
  }

  const symbol = String(req.query?.symbol || "").trim().toUpperCase();
  if (!/^\^?[A-Z0-9._:&-]{1,40}$/.test(symbol)) {
    return res.status(400).json({ error: "A valid symbol is required." });
  }

  const interval = String(req.query?.interval || "1day");
  if (!INTERVALS.includes(interval)) {
    return res.status(400).json({ error: "Unsupported interval.", supported: INTERVALS });
  }

  try {
    const data = await getCandles(symbol, {
      exchange: String(req.query?.exchange || "").trim().toUpperCase(),
      interval,
      limit: req.query?.limit
    });

    return res.status(200).json({
      mode: "historical",
      instrumentId: data.instrumentId,
      symbol: data.symbol,
      exchange: data.exchange,
      interval: data.interval,
      source: data.source,
      candles: data.candles,
      coverage: data.coverage,
      droppedRows: data.droppedRows,
      retrievedAt: data.retrievedAt,
      updatedAt: data.retrievedAt,
      cached: data.cached
    });
  } catch (error) {
    return res.status(error.statusCode || 503).json({
      error: error.message || "Historical candles are unavailable.",
      ...(error.details ? { details: error.details } : {})
    });
  }
}
