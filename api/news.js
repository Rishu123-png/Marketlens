// News and official-filing evidence for one instrument.
// Text is untrusted evidence: sanitized, deduplicated and timestamped server-side.
import { gatherEvidence } from "../server/news/service.js";
import { rateLimit } from "../lib/server/rateLimit.js";

export default async function handler(req, res) {
  const quota = await rateLimit(req, { name: "news", limit: 30, windowMs: 60_000 });
  if (!quota.allowed) {
    res.setHeader?.("Retry-After", String(quota.retryAfterSeconds));
    return res.status(429).json({
      error: "Too many news requests. Please try again shortly.",
      retryAfterSeconds: quota.retryAfterSeconds
    });
  }

  const symbol = String(req.query?.symbol || "").trim().toUpperCase();
  if (!/^\^?[A-Z0-9._:&-]{1,40}$/.test(symbol)) {
    return res.status(400).json({ error: "A valid symbol is required." });
  }

  try {
    const data = await gatherEvidence({
      symbol,
      exchange: String(req.query?.exchange || "").trim().toUpperCase(),
      query: typeof req.query?.q === "string" ? req.query.q.slice(0, 200) : undefined,
      limit: req.query?.limit,
      includeFilings: req.query?.filings !== "false"
    });

    return res.status(200).json({
      mode: "evidence",
      instrumentId: data.instrumentId,
      symbol: data.instrument.symbol,
      exchange: data.instrument.exchange,
      evidence: data.items,
      counts: data.counts,
      sources: data.sources,
      rejected: data.rejected,
      retrievedAt: data.retrievedAt,
      cached: data.cached,
      limitations: data.limitations
    });
  } catch (error) {
    return res.status(error.statusCode || 503).json({
      error: error.message || "News evidence is unavailable."
    });
  }
}
