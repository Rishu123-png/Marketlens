// Batch verified quotes for watchlists and portfolios. Each symbol is resolved
// independently; failures are returned per symbol and never replaced.
import { getVerifiedQuote, mapConcurrent } from "../server/market-data/gateway.js";
import { rateLimit } from "../lib/server/rateLimit.js";

const MAX_SYMBOLS = 24;

export default async function handler(req, res) {
  const quota = await rateLimit(req, { name: "quotes", limit: 60, windowMs: 60_000 });
  if (!quota.allowed) {
    res.setHeader?.("Retry-After", String(quota.retryAfterSeconds));
    return res.status(429).json({
      error: "Too many quote requests. Please try again shortly.",
      retryAfterSeconds: quota.retryAfterSeconds
    });
  }

  const defaultExchange = String(req.query?.exchange || "").trim().toUpperCase();
  const raw = String(req.query?.symbols || "")
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);

  // `SYMBOL@EXCHANGE` keeps dual-listed companies (for example RELIANCE on NSE
  // and BSE) apart. Plain symbols fall back to the shared exchange parameter.
  const targets = [];
  const seen = new Set();
  for (const entry of raw) {
    const [symbol, exchange = ""] = entry.split("@");
    const venue = exchange || defaultExchange;
    const key = `${symbol}|${venue || "AUTO"}`;
    if (!symbol || seen.has(key)) continue;
    seen.add(key);
    targets.push({ symbol, exchange: venue });
    if (targets.length >= MAX_SYMBOLS) break;
  }

  if (!targets.length) {
    return res.status(400).json({ error: "Provide symbols=A,B,C (optionally SYMBOL@EXCHANGE)." });
  }
  const invalid = targets.find(
    (target) =>
      !/^\^?[A-Z0-9._:&-]{1,40}$/.test(target.symbol) ||
      (target.exchange && !/^(NSE|BSE|NASDAQ|NYSE|AMEX|INDEX)$/.test(target.exchange))
  );
  if (invalid) {
    return res.status(400).json({ error: "One or more symbols or exchanges are invalid." });
  }

  const results = await mapConcurrent(targets, 6, async ({ symbol, exchange }) => {
    try {
      const quote = await getVerifiedQuote(symbol, { exchange });
      return { symbol, exchange: quote?.exchange || exchange || null, quote };
    } catch (error) {
      return {
        symbol,
        exchange: exchange || null,
        quote: null,
        error: error instanceof Error ? error.message : "Quote unavailable.",
        details: error?.details ?? null
      };
    }
  });

  const verified = results.filter((entry) => entry.quote);

  return res.status(200).json({
    generatedAt: new Date().toISOString(),
    requested: targets.length,
    verified: verified.length,
    quotes: verified,
    failures: results.filter((entry) => !entry.quote),
    note: "Only provider-verified quotes are returned; failures are not filled. Entries are keyed by symbol and exchange."
  });
}
