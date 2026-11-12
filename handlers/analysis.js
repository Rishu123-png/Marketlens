// Chart Lab payload: candles + deterministic indicators + deterministic patterns.
// AI interpretation is deliberately absent from this endpoint.
import { getCandles } from "../server/market-data/candles.js";
import { INDICATOR_ENGINE_VERSION, indicatorSnapshot } from "../server/indicators/index.js";
import { PATTERN_ENGINE_VERSION, analyzeChart } from "../server/patterns/index.js";
import { rateLimit } from "../lib/server/rateLimit.js";

export default async function handler(req, res) {
  const quota = await rateLimit(req, { name: "analysis", limit: 30, windowMs: 60_000 });
  if (!quota.allowed) {
    res.setHeader?.("Retry-After", String(quota.retryAfterSeconds));
    return res.status(429).json({
      error: "Too many analysis requests. Please try again shortly.",
      retryAfterSeconds: quota.retryAfterSeconds
    });
  }

  const symbol = String(req.query?.symbol || "").trim().toUpperCase();
  if (!/^\^?[A-Z0-9._:&-]{1,40}$/.test(symbol)) {
    return res.status(400).json({ error: "A valid symbol is required." });
  }

  try {
    const data = await getCandles(symbol, {
      exchange: String(req.query?.exchange || "").trim().toUpperCase(),
      interval: req.query?.interval || "1day",
      limit: req.query?.limit
    });

    return res.status(200).json({
      mode: "deterministic-analysis",
      instrumentId: data.instrumentId,
      symbol: data.symbol,
      exchange: data.exchange,
      interval: data.interval,
      source: data.source,
      candles: data.candles,
      indicators: indicatorSnapshot(data.candles),
      chart: analyzeChart(data.candles),
      versions: {
        indicators: INDICATOR_ENGINE_VERSION,
        patterns: PATTERN_ENGINE_VERSION
      },
      coverage: data.coverage,
      droppedRows: data.droppedRows,
      retrievedAt: data.retrievedAt,
      limitations: [
        "Calculations are deterministic and historical; they do not forecast prices",
        "AI interpretation is a separate step and is not part of this response"
      ]
    });
  } catch (error) {
    return res.status(error.statusCode || 503).json({
      error: error.message || "Chart analysis is unavailable.",
      ...(error.details ? { details: error.details } : {})
    });
  }
}
