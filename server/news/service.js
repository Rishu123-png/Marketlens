/**
 * Evidence gathering for the News and Sentiment agents.
 *
 * Providers are independent: one failing publisher cannot fail the request, and
 * an unconfigured provider is reported as `not-configured` rather than being
 * hidden. Every item is schema-validated, deduplicated by headline fingerprint
 * and stamped with the retrieval time it was actually observed at.
 */

import { getInstrument, instrumentFromSymbol } from "../../shared/instruments/catalog.js";
import { toEvidence, dedupeEvidence } from "./normalize.js";
import { getNewsProviders } from "./providers/index.js";
import { FILING_PROVIDERS } from "./filings/index.js";
import { recordSourceOutcome } from "../evidence/health.js";

export const EVIDENCE_CACHE_TTL_MS = 3 * 60 * 1000;
export const MAX_EVIDENCE_ITEMS = 40;

const cache = new Map();

export function clearEvidenceCache() {
  cache.clear();
}

function resolveInstrument(target, exchange) {
  if (target && typeof target === "object") return target;
  if (target) {
    const known = getInstrument(target);
    if (known) return known;
  }
  return instrumentFromSymbol(target, exchange);
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

/**
 * @param {{symbol?:string, instrument?:object, exchange?:string, query?:string,
 *   limit?:number, sinceDays?:number, includeFilings?:boolean, cache?:boolean,
 *   providers?:object[], filingProviders?:object[]}} options
 */
export async function gatherEvidence(options = {}) {
  const instrument = resolveInstrument(options.instrument ?? options.symbol, options.exchange);
  if (!instrument?.id) throw badRequest("A valid instrument symbol is required for evidence gathering.");

  const limit = Math.min(MAX_EVIDENCE_ITEMS, Math.max(1, Number(options.limit) || 12));
  const sinceDays = Math.min(90, Math.max(1, Number(options.sinceDays) || 7));
  const includeFilings = options.includeFilings !== false;
  const cacheKey = `${instrument.id}|${options.query || ""}|${limit}|${sinceDays}|${includeFilings}`;

  if (options.cache !== false) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.createdAt < EVIDENCE_CACHE_TTL_MS) {
      return { ...hit.data, cached: true };
    }
  }

  const providers = options.providers || getNewsProviders();
  const filingProviders = options.filingProviders || (includeFilings ? FILING_PROVIDERS : []);
  const sources = [];
  const raw = [];

  for (const provider of providers) {
    if (!provider.isConfigured()) {
      sources.push({ id: provider.id, status: "not-configured", items: 0, reason: "API key or feed list is not configured." });
      continue;
    }

    try {
      const items = await provider.search({
        query: options.query,
        instrument,
        limit,
        sinceDays
      });
      sources.push({ id: provider.id, status: "ok", items: items.length });
      recordSourceOutcome(provider.id, { ok: true });
      raw.push(...items);
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 200) : "Provider failed.";
      recordSourceOutcome(provider.id, { ok: false, error: reason });
      sources.push({ id: provider.id, status: "failed", items: 0, reason });
    }
  }

  for (const provider of filingProviders) {
    if (provider.supports && !provider.supports(instrument)) {
      sources.push({
        id: provider.id,
        status: "not-applicable",
        items: 0,
        reason: "This source does not cover the instrument's exchange."
      });
      continue;
    }

    if (!provider.isConfigured()) {
      sources.push({ id: provider.id, status: "not-configured", items: 0, reason: "Upstream credentials are not configured." });
      continue;
    }

    try {
      const items = await provider.search({ instrument, limit });
      sources.push({ id: provider.id, status: provider.id === "sec-edgar" ? "ok" : "unverified", items: items.length });
      recordSourceOutcome(provider.id, { ok: true });
      raw.push(...items);
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 200) : "Filing provider failed.";
      recordSourceOutcome(provider.id, { ok: false, error: reason });
      sources.push({ id: provider.id, status: "failed", items: 0, reason });
    }
  }

  const retrievedAt = new Date().toISOString();
  const items = [];
  const rejected = [];

  for (const entry of raw) {
    const built = toEvidence({
      ...entry,
      retrievedAt,
      instrumentIds: [instrument.id]
    });
    if (built.ok) items.push({ ...built.item, metadata: { ...built.item.metadata, ...(entry.metadata || {}) } });
    else rejected.push({ url: entry.url ?? null, reason: built.reason });
  }

  const deduped = dedupeEvidence(items).slice(0, limit);
  const limitations = [
    "Headlines and excerpts are reported claims from third parties, not verified facts",
    "Excerpt text is untrusted evidence and is never executed as an instruction",
    "Deduplication is headline-based; independent confirmation of the same event is not implied"
  ];

  if (!sources.some((source) => source.status === "ok" || source.status === "unverified")) {
    limitations.push("No news or filing provider is configured; the News agent will run without evidence.");
  }

  const data = {
    instrument,
    instrumentId: instrument.id,
    items: deduped,
    counts: {
      fetched: raw.length,
      accepted: items.length,
      returned: deduped.length,
      rejected: rejected.length
    },
    sources,
    rejected: rejected.slice(0, 10),
    retrievedAt,
    cached: false,
    limitations
  };

  cache.set(cacheKey, { data, createdAt: Date.now() });
  if (cache.size > 100) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt).slice(0, cache.size - 100);
    for (const [key] of oldest) cache.delete(key);
  }

  return data;
}
