// Official open-data (data.gov.in) reference datasets.
// Opt-in: requires DATA_GOV_IN_API_KEY. Never used for prices or candles.
import { dataGovClient } from "../server/evidence/dataGovIn.js";
import { rateLimit } from "../lib/server/rateLimit.js";

function parseFilters(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  const quota = await rateLimit(req, { name: "official-data", limit: 20, windowMs: 60_000 });
  if (!quota.allowed) {
    res.setHeader?.("Retry-After", String(quota.retryAfterSeconds));
    return res.status(429).json({ error: "Too many open-data requests. Please try again shortly." });
  }

  if (!dataGovClient.isConfigured()) {
    return res.status(503).json({
      ok: false,
      error: "data.gov.in is not configured (DATA_GOV_IN_API_KEY).",
      source: "data.gov.in"
    });
  }

  const resource = String(req.query?.resource || "").trim();
  if (!resource) {
    return res.status(400).json({ error: "A data.gov.in resource id is required." });
  }

  try {
    const data = await dataGovClient.fetchResource(resource, {
      limit: req.query?.limit,
      offset: req.query?.offset,
      filters: parseFilters(req.query?.filters)
    });
    return res.status(200).json({ ok: true, ...data });
  } catch (error) {
    return res.status(error.statusCode || 502).json({
      ok: false,
      error: error instanceof Error ? error.message : "data.gov.in is unavailable.",
      source: "data.gov.in"
    });
  }
}
