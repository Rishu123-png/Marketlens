// Instrument discovery: catalog identity, filtering and local search.
// Provider-backed symbol lookup stays in /api/search; this endpoint is the
// registry that everything else resolves against.
import {
  INSTRUMENTS,
  getInstrument,
  listInstruments,
  searchInstruments
} from "../shared/instruments/catalog.js";
import { rateLimit } from "../lib/server/rateLimit.js";

const ASSET_TYPES = ["equity", "index", "etf"];
const MAX_LIMIT = 200;

function toPublic(instrument) {
  return {
    id: instrument.id,
    symbol: instrument.symbol,
    name: instrument.name,
    exchange: instrument.exchange,
    country: instrument.country,
    currency: instrument.currency,
    assetType: instrument.assetType,
    sector: instrument.sector
  };
}

function readInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

export default async function handler(req, res) {
  const quota = await rateLimit(req, {
    name: "instruments",
    limit: 120,
    windowMs: 60_000
  });

  if (!quota.allowed) {
    res.setHeader?.("Retry-After", String(quota.retryAfterSeconds));
    return res.status(429).json({
      error: "Too many instrument requests. Please try again shortly.",
      retryAfterSeconds: quota.retryAfterSeconds
    });
  }

  const id = String(req.query?.id || "").trim();
  if (id) {
    const instrument = getInstrument(id);
    if (!instrument) {
      return res.status(404).json({ error: "Unknown instrument." });
    }
    return res.status(200).json({ instrument: toPublic(instrument) });
  }

  const query = String(req.query?.q || "").trim();
  if (query.length > 60) {
    return res.status(400).json({ error: "Search query is too long." });
  }

  const assetType = String(req.query?.assetType || "").trim().toLowerCase();
  if (assetType && !ASSET_TYPES.includes(assetType)) {
    return res.status(400).json({
      error: "Unsupported asset type.",
      supported: ASSET_TYPES
    });
  }

  const filters = {
    country: String(req.query?.country || "").trim(),
    exchange: String(req.query?.exchange || "").trim(),
    assetType,
    sector: String(req.query?.sector || "").trim()
  };

  const limit = Math.min(MAX_LIMIT, Math.max(1, readInteger(req.query?.limit, 50)));
  const offset = Math.max(0, readInteger(req.query?.offset, 0));

  const matched = query ? searchInstruments(query, filters) : listInstruments(filters);
  const page = matched.slice(offset, offset + limit);

  return res.status(200).json({
    query: query || null,
    filters,
    total: matched.length,
    catalogSize: INSTRUMENTS.length,
    offset,
    limit,
    count: page.length,
    instruments: page.map(toPublic)
  });
}
