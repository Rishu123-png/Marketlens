// Market screener over provider-verified quotes with optional technical filters.
import { runScreener } from "../server/market/screener.js";
import { rateLimit } from "../lib/server/rateLimit.js";

export default async function handler(req, res) {
  const quota = await rateLimit(req, { name: "screener", limit: 20, windowMs: 60_000 });
  if (!quota.allowed) {
    res.setHeader?.("Retry-After", String(quota.retryAfterSeconds));
    return res.status(429).json({
      error: "Too many screener requests. Please try again shortly.",
      retryAfterSeconds: quota.retryAfterSeconds
    });
  }

  try {
    return res.status(200).json(await runScreener(req.query || {}));
  } catch (error) {
    return res.status(error.statusCode || 503).json({
      error: error instanceof Error ? error.message : "Screener is unavailable.",
      ...(error.details ? { details: error.details } : {})
    });
  }
}
