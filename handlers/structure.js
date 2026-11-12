// Deterministic market structure: BOS, CHoCH, order-block hypotheses, FVGs,
// equal highs/lows and liquidity-sweep hypotheses, derived from real candles.
import { getCandles, INTERVALS } from "../server/market-data/candles.js";
import { STRUCTURE_ENGINE_VERSION, analyzeMarketStructure } from "../server/patterns/structure.js";
import { rateLimit } from "../lib/server/rateLimit.js";

export default async function handler(req, res) {
  const quota = await rateLimit(req, { name: "structure", limit: 30, windowMs: 60_000 });
  if (!quota.allowed) {
    res.setHeader?.("Retry-After", String(quota.retryAfterSeconds));
    return res.status(429).json({
      error: "Too many structure requests. Please try again shortly.",
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
      limit: req.query?.limit ?? 400
    });

    const structure = analyzeMarketStructure(data.candles, { interval });

    return res.status(200).json({
      mode: "deterministic-structure",
      engineVersion: STRUCTURE_ENGINE_VERSION,
      instrumentId: data.instrumentId,
      symbol: data.symbol,
      exchange: data.exchange,
      interval,
      source: data.source,
      candles: data.candles.length,
      structure,
      coverage: data.coverage,
      droppedRows: data.droppedRows,
      retrievedAt: data.retrievedAt,
      limitations: [
        "Order blocks, sweeps and liquidity levels are geometric hypotheses, not observed institutional orders.",
        "No output is a forecast or investment advice."
      ]
    });
  } catch (error) {
    return res.status(error.statusCode || 503).json({
      error: error.message || "Market structure is unavailable.",
      ...(error.details ? { details: error.details } : {})
    });
  }
}
