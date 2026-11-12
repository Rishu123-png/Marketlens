// Market overview: indices, verified-universe breadth, sectors, movers, heatmap
// and data-freshness. Quote acquisition lives in the market-data gateway; this
// handler enforces rate limits and maps failures to the HTTP contract.
import { buildMarketOverview } from "../server/market/overview.js";
import { rateLimit } from "../lib/server/rateLimit.js";

export default async function handler(req, res) {
  const quota = await rateLimit(req, { name: "market-overview", limit: 30, windowMs: 60_000 });
  if (!quota.allowed) {
    res.setHeader?.("Retry-After", String(quota.retryAfterSeconds));
    return res.status(429).json({
      error: "Too many market overview requests. Please try again shortly.",
      retryAfterSeconds: quota.retryAfterSeconds
    });
  }

  try {
    const overview = await buildMarketOverview();
    res.setHeader?.("Cache-Control", "private, max-age=30");
    return res.status(200).json(overview);
  } catch (error) {
    return res.status(error?.statusCode || 503).json({
      error: error instanceof Error ? error.message : "Market overview is unavailable."
    });
  }
}
