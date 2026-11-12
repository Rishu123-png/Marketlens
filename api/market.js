// Verified market-data endpoint. Thin HTTP shell over the shared gateway:
// provider order, fallback, normalization and caching live in server/market-data.
import { getVerifiedQuote } from "../server/market-data/gateway.js";
import { rateLimit } from "../lib/server/rateLimit.js";

// Backwards-compatible export: api/report.js and older callers import this.
export { getVerifiedQuote };

export default async function handler(req, res) {
  const quota = await rateLimit(req, {
    name: "market",
    limit: 120,
    windowMs: 60_000
  });

  if (!quota.allowed) {
    res.setHeader?.("Retry-After", String(quota.retryAfterSeconds));
    return res.status(429).json({
      error: "Too many quote requests. Please try again shortly.",
      retryAfterSeconds: quota.retryAfterSeconds
    });
  }

  const symbol = String(req.query?.symbol || "").trim().toUpperCase();
  const exchange = String(req.query?.exchange || "").trim().toUpperCase();

  if (!symbol) {
    return res.status(400).json({ error: "A stock symbol is required." });
  }

  try {
    return res.status(200).json(await getVerifiedQuote(symbol, { exchange }));
  } catch (error) {
    return res.status(error.statusCode || 503).json({
      error: error.message || "Market data unavailable.",
      ...(error.details ? { details: error.details } : {})
    });
  }
}
