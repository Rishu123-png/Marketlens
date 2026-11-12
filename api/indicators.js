// Deterministic indicator snapshots for one instrument and interval.
// The Technical agent consumes the same engine; nothing here is model-generated.
import { getCandles } from "../server/market-data/candles.js";
import { INDICATOR_ENGINE_VERSION, indicatorSnapshot } from "../server/indicators/index.js";
import { rateLimit } from "../lib/server/rateLimit.js";

export default async function handler(req, res) {
  const quota = await rateLimit(req, { name: "indicators", limit: 60, windowMs: 60_000 });
  if (!quota.allowed) {
    res.setHeader?.("Retry-After", String(quota.retryAfterSeconds));
    return res.status(429).json({
      error: "Too many indicator requests. Please try again shortly.",
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

    const indicators = indicatorSnapshot(data.candles);

    return res.status(200).json({
      instrumentId: data.instrumentId,
      symbol: data.symbol,
      exchange: data.exchange,
      interval: data.interval,
      source: data.source,
      candles: indicators.candles,
      indicators,
      calculation: {
        engine: "marketlens-indicators",
        version: INDICATOR_ENGINE_VERSION,
        generatedAt: new Date().toISOString(),
        parameters: {
          rsiPeriod: 14,
          macd: { fast: 12, slow: 26, signal: 9 },
          movingAverages: { sma: [20, 50, 100, 200], ema: [9, 20, 50] },
          atrPeriod: 14,
          bollinger: { period: 20, deviations: 2, deviationType: "population" },
          volumeBaseline: 20
        }
      },
      coverage: data.coverage,
      droppedRows: data.droppedRows,
      retrievedAt: data.retrievedAt
    });
  } catch (error) {
    return res.status(error.statusCode || 503).json({
      error: error.message || "Indicator calculation is unavailable.",
      ...(error.details ? { details: error.details } : {})
    });
  }
}
