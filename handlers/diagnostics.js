// Internal Data & AI Diagnostics. Two explicitly separate panels: Groq AI
// credential/execution telemetry and market-data request/coverage telemetry.
// No secret values or provider URLs are exposed.
import { rateLimit } from "../lib/server/rateLimit.js";
import { buildAiDiagnostics } from "../server/ai/diagnostics.js";
import { buildMarketDiagnostics } from "../server/market-data/diagnostics.js";

export default async function handler(req, res) {
  const quota = await rateLimit(req, { name: "diagnostics", limit: 60, windowMs: 60_000 });
  if (!quota.allowed) {
    res.setHeader?.("Retry-After", String(quota.retryAfterSeconds));
    return res.status(429).json({
      error: "Too many diagnostics requests. Please try again shortly.",
      retryAfterSeconds: quota.retryAfterSeconds
    });
  }

  return res.status(200).json({
    ok: true,
    generatedAt: new Date().toISOString(),
    separation:
      "Groq AI connectivity and market-data connectivity are independent. A successful AI call does not prove quote/candle coverage, and vice versa.",
    ai: buildAiDiagnostics(),
    market: buildMarketDiagnostics(),
    security: {
      secretsExposed: false,
      note: "Credential values, prefixes, Authorization headers and provider URLs are not included."
    }
  });
}
