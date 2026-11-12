// Instrument discovery: the merged master (bundled catalogue + provider
// directory), local search, provider availability and pagination.
//
// A listed instrument is not a promise of a quote: `availability.quoteEnabled`
// is derived from configured providers that actually map the instrument, and
// `quoteVerifiedRecently` only from observed successful calls.
import { INSTRUMENTS, getInstrument } from "../shared/instruments/catalog.js";
import {
  ASSET_TYPES,
  EXCHANGES,
  buildInstrumentMatrix,
  publicInstrument,
  searchInstrumentMaster
} from "../server/instruments/service.js";
import { getDirectory } from "../server/instruments/directory.js";
import { rateLimit } from "../lib/server/rateLimit.js";

const MAX_LIMIT = 500;

function readInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function readList(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 12);
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
    return res.status(200).json({ instrument: publicInstrument(instrument) });
  }

  if (String(req.query?.coverage || "") === "1") {
    return res.status(200).json({ ok: true, matrix: buildInstrumentMatrix() });
  }

  const query = String(req.query?.q || "").trim();
  if (query.length > 60) {
    return res.status(400).json({ error: "Search query is too long." });
  }

  const assetTypes = readList(req.query?.assetType || req.query?.assetTypes).map((value) => value.toLowerCase());
  const unsupported = assetTypes.filter((value) => !ASSET_TYPES.includes(value));
  if (unsupported.length) {
    return res.status(400).json({
      error: `Unsupported asset type: ${unsupported.join(", ")}.`,
      supported: ASSET_TYPES
    });
  }

  const exchanges = readList(req.query?.exchange || req.query?.exchanges).map((value) => value.toUpperCase());
  const unsupportedExchanges = exchanges.filter((value) => !EXCHANGES.includes(value));
  if (unsupportedExchanges.length) {
    return res.status(400).json({
      error: `Unsupported exchange: ${unsupportedExchanges.join(", ")}.`,
      supported: EXCHANGES
    });
  }

  const filters = {
    country: readList(req.query?.country),
    exchange: exchanges,
    assetType: assetTypes,
    sector: readList(req.query?.sector)
  };

  const limit = Math.min(MAX_LIMIT, Math.max(1, readInteger(req.query?.limit, 50)));
  const offset = Math.max(0, readInteger(req.query?.offset, 0));
  const includeDirectory = req.query?.directory !== "0";
  const refreshDirectory = req.query?.refreshDirectory === "1";

  try {
    if (refreshDirectory) await getDirectory({ refresh: true });

    const payload = await searchInstrumentMaster(query, filters, {
      limit,
      offset,
      includeDirectory
    });

    return res.status(200).json({
      ...payload,
      page: offset / limit + 1,
      catalogSize: INSTRUMENTS.length,
      assetTypes: ASSET_TYPES,
      exchanges: EXCHANGES,
      note: "Catalogue presence does not imply a live quote. Check availability.quoteEnabled and quoteVerifiedRecently."
    });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : "Instrument search is unavailable."
    });
  }
}
