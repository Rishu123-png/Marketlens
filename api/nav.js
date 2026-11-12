// Official end-of-day NAV reference from AMFI (funds and ETFs).
// Delayed by design: this endpoint never claims to be a live price.
import { amfiNavClient } from "../server/evidence/amfiNav.js";
import { rateLimit } from "../lib/server/rateLimit.js";

export default async function handler(req, res) {
  const quota = await rateLimit(req, { name: "nav", limit: 30, windowMs: 60_000 });
  if (!quota.allowed) {
    res.setHeader?.("Retry-After", String(quota.retryAfterSeconds));
    return res.status(429).json({ error: "Too many NAV requests. Please try again shortly." });
  }

  const isin = String(req.query?.isin || "").trim().toUpperCase();
  const schemeCode = String(req.query?.schemeCode || "").trim();

  if (!isin && !schemeCode) {
    return res.status(400).json({ error: "Provide an ISIN or an AMFI scheme code." });
  }
  if (isin && !/^IN[A-Z0-9]{10}$/.test(isin)) {
    return res.status(400).json({ error: "ISIN must be a 12-character Indian ISIN." });
  }
  if (schemeCode && !/^\d{4,8}$/.test(schemeCode)) {
    return res.status(400).json({ error: "AMFI scheme code must be 4-8 digits." });
  }

  try {
    const data = await amfiNavClient.lookup({ isin, schemeCode });
    return res.status(200).json({ ok: data.status === "available", ...data });
  } catch (error) {
    return res.status(error.statusCode === 400 ? 400 : 503).json({
      ok: false,
      status: "unavailable",
      error: error instanceof Error ? error.message : "AMFI NAV is unavailable.",
      source: "AMFI",
      delayed: true
    });
  }
}
