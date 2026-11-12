/**
 * data.gov.in (Open Government Data platform) adapter.
 *
 * Documented interface: `https://api.data.gov.in/resource/{resource_id}`
 * with `api-key`, `format=json`, `limit` and `offset`. A free key is required
 * and each dataset carries its own licence (usually the Government Open Data
 * Licence – India), so this adapter is opt-in: without `DATA_GOV_IN_API_KEY` it
 * reports itself as not configured and nothing is requested.
 *
 * Scope: macro and reference datasets only. There is no NSE/BSE OHLCV series on
 * OGD, and this adapter must not be used to fake a price feed.
 */

import { officialSourceCache } from "./cache.js";
import { recordSourceOutcome } from "./health.js";

export const DATA_GOV_IN_BASE = "https://api.data.gov.in/resource";
export const DATA_GOV_IN_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
export const DATA_GOV_IN_MAX_LIMIT = 100;

function normalizeLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 10;
  return Math.min(DATA_GOV_IN_MAX_LIMIT, Math.max(1, Math.trunc(number)));
}

export function createDataGovClient({
  fetchImpl = globalThis.fetch,
  apiKey = process.env.DATA_GOV_IN_API_KEY,
  cache = officialSourceCache,
  now = () => Date.now()
} = {}) {
  function isConfigured() {
    return Boolean(apiKey);
  }

  /**
   * @param {string} resourceId e.g. a dataset UUID from data.gov.in
   * @param {{limit?:number, offset?:number, filters?:Record<string,string|number>}} options
   */
  async function fetchResource(resourceId, options = {}) {
    if (!isConfigured()) {
      const error = new Error("data.gov.in requires DATA_GOV_IN_API_KEY.");
      error.statusCode = 503;
      throw error;
    }
    if (!/^[a-zA-Z0-9._-]{3,120}$/.test(String(resourceId ?? ""))) {
      const error = new Error("A valid data.gov.in resource id is required.");
      error.statusCode = 400;
      throw error;
    }

    const limit = normalizeLimit(options.limit);
    const offset = Math.max(0, Math.trunc(Number(options.offset) || 0));
    const filters = Object.entries(options.filters ?? {}).slice(0, 10);
    const cacheKey = `ogd:${resourceId}:${limit}:${offset}:${JSON.stringify(filters)}`;

    const { value, cached, fetchedAt } = await cache.getOrLoad(cacheKey, DATA_GOV_IN_CACHE_TTL_MS, async () => {
      const url = new URL(`${DATA_GOV_IN_BASE}/${resourceId}`);
      url.searchParams.set("api-key", apiKey);
      url.searchParams.set("format", "json");
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));
      for (const [key, entry] of filters) url.searchParams.set(key, String(entry));

      const response = await fetchImpl(url, {
        headers: { accept: "application/json", "user-agent": "MarketLens/1.0 (official data)" },
        signal: AbortSignal.timeout(10_000)
      });

      if (!response.ok) {
        const error = new Error(`data.gov.in responded ${response.status}.`);
        error.statusCode = response.status === 429 ? 429 : 502;
        recordSourceOutcome("data-gov-in", { ok: false, error: error.message });
        throw error;
      }

      const payload = await response.json();
      recordSourceOutcome("data-gov-in", { ok: true });
      return {
        total: Number(payload?.total) || 0,
        count: Number(payload?.count) || (Array.isArray(payload?.records) ? payload.records.length : 0),
        records: Array.isArray(payload?.records) ? payload.records.slice(0, limit) : []
      };
    });

    return {
      resourceId,
      limit,
      offset,
      cached,
      fetchedAt,
      ...value,
      retrievedAt: new Date(now()).toISOString(),
      source: "data.gov.in",
      official: true,
      licenceNote: "Per-dataset licence; check the dataset page before redistribution."
    };
  }

  return { id: "data-gov-in", isConfigured, fetchResource };
}

export const dataGovClient = createDataGovClient();
