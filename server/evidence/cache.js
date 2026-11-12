/**
 * Small TTL cache shared by official-source adapters.
 *
 * Why a cache module instead of a per-adapter `Map`: the whole point of the
 * evidence redesign is to *reduce* external requests, and one place makes the
 * policy visible — TTL, entry cap, hit/miss counters, and a `fetchedAt` stamp
 * that the UI can show as "as of". A failed load is never cached, so an outage
 * cannot be frozen in place.
 */

export function createTtlCache({ now = () => Date.now(), maxEntries = 250 } = {}) {
  const entries = new Map();
  const counters = { hits: 0, misses: 0, loads: 0, failures: 0, evictions: 0 };

  function evictIfNeeded() {
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      entries.delete(oldest);
      counters.evictions += 1;
    }
  }

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (now() - entry.createdAt >= entry.ttlMs) {
        entries.delete(key);
        return null;
      }
      counters.hits += 1;
      return entry;
    },

    set(key, value, ttlMs) {
      const entry = { value, createdAt: now(), ttlMs };
      entries.set(key, entry);
      evictIfNeeded();
      return entry;
    },

    delete(key) {
      return entries.delete(key);
    },

    clear() {
      entries.clear();
    },

    stats() {
      return {
        entries: entries.size,
        maxEntries,
        ...counters,
        keys: [...entries.keys()].slice(0, 50)
      };
    },

    /**
     * Return the cached value or run `loader` once and cache its result.
     * Concurrent callers are not deduplicated: these adapters are called from
     * request handlers, not a hot loop, and a duplicate fetch is cheaper than a
     * stuck promise.
     */
    async getOrLoad(key, ttlMs, loader) {
      const hit = this.get(key);
      if (hit) return { value: hit.value, cached: true, fetchedAt: new Date(hit.createdAt).toISOString() };

      counters.misses += 1;
      counters.loads += 1;

      try {
        const value = await loader();
        const entry = this.set(key, value, ttlMs);
        return { value, cached: false, fetchedAt: new Date(entry.createdAt).toISOString() };
      } catch (error) {
        counters.failures += 1;
        throw error;
      }
    }
  };
}

/** Process-wide cache for official sources (exported for status/debugging). */
export const officialSourceCache = createTtlCache();
