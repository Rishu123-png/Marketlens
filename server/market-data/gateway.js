/**
 * Verified quote gateway.
 *
 * One entry point for every quote in Market Lens: endpoint handlers, batch
 * ranking and (later) the research orchestrator all go through here. It owns
 * provider order, fallback, caching and the "no fabricated price" rule: if no
 * provider returns a usable price, this throws — it never returns a placeholder.
 */

import { instrumentFromSymbol } from "../../shared/instruments/catalog.js";
import { quoteSchema } from "../../shared/schemas/quote.js";
import { validateQuoteIdentity } from "./identity.js";
import { recordQuoteObservation } from "./observations.js";
import { getProviderOrder, getProviders } from "./providers/index.js";

const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_BUDGET_MS = 25_000;
const PER_PROVIDER_TIMEOUT_MS = 10_000;
const MAX_CACHE_ENTRIES = 500;
const SYMBOL_PATTERN = /^\^?[A-Z0-9._:&-]{1,40}$/;

const cache = new Map();

export function clearQuoteCache() {
  cache.clear();
}

function remember(key, data) {
  cache.set(key, { data, createdAt: Date.now() });

  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = [...cache.entries()]
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
      .slice(0, cache.size - MAX_CACHE_ENTRIES);
    for (const [staleKey] of oldest) cache.delete(staleKey);
  }
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function resolveInstrument(target, exchange) {
  if (target && typeof target === "object") return target;
  return instrumentFromSymbol(target, exchange);
}

/**
 * @param {object|string} target Catalog instrument, or a bare symbol.
 * @param {{ exchange?: string, providers?: object[], primary?: string, cache?: boolean, cacheTtlMs?: number }} [options]
 */
export async function getVerifiedQuote(target, options = {}) {
  const instrument = resolveInstrument(target, options.exchange);

  if (!instrument?.symbol) throw badRequest("A stock symbol is required.");
  if (!SYMBOL_PATTERN.test(instrument.symbol)) throw badRequest("Invalid stock symbol.");

  const cacheKey = `${instrument.id}|${instrument.exchange}`;
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

  if (options.cache !== false) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.createdAt < ttl) {
      return { ...hit.data, cached: true };
    }
  }

  const providers = options.providers || getProviders(getProviderOrder(options.primary));
  const errors = [];
  const budgetMs = Number(options.budgetMs) > 0 ? Number(options.budgetMs) : DEFAULT_BUDGET_MS;
  const startedAt = Date.now();

  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index];
    const remaining = budgetMs - (Date.now() - startedAt);
    if (remaining <= 0) {
      errors.push({ provider: provider.id, message: "Quote budget exhausted before this provider was tried." });
      continue;
    }

    if (!provider.supports(instrument)) {
      errors.push({
        provider: provider.id,
        message: "Instrument is not mapped for this provider."
      });
      continue;
    }

    let quote;
    let timer = null;
    try {
      // A single slow provider must not consume the whole serverless request.
      const timeoutMs = Math.min(remaining, PER_PROVIDER_TIMEOUT_MS);
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${provider.id} exceeded ${timeoutMs} ms.`)),
          timeoutMs
        );
        timer.unref?.();
      });
      quote = await Promise.race([provider.fetchQuote(instrument), timeoutPromise]);

      if (quote.quoteVerified !== true || quote.price === null) {
        throw new Error(`${provider.id} returned no verified price.`);
      }

      // Identity first: a structurally valid quote for the wrong listing is
      // worse than no quote, because it looks trustworthy.
      const identity = validateQuoteIdentity(instrument, quote);
      if (!identity.ok) {
        throw new Error(`${provider.id} quote failed identity validation: ${identity.reason}`);
      }

      // Enforce the quote contract at the provider boundary. A drifted adapter
      // must degrade to the next provider, not leak a malformed quote upward.
      const contract = quoteSchema.safeParse(quote);
      if (!contract.success) {
        const firstIssue = contract.error.issues[0];
        throw new Error(
          `${provider.id} returned a quote that failed contract validation (${firstIssue.path.join(".") || "root"}: ${firstIssue.message}).`
        );
      }

      const data = {
        ...quote,
        provider: quote.provider || provider.id,
        source: quote.source || provider.label,
        cached: false,
        fallbackUsed: index > 0,
        providerErrors: errors,
        identity: identity.checks
      };

      remember(cacheKey, data);
      recordQuoteObservation({
        instrumentId: instrument.id,
        provider: data.provider,
        ok: true,
        quote: data
      });
      return data;
    } catch (error) {
      errors.push({
        provider: provider.id,
        message: error instanceof Error ? error.message : "Unknown provider error"
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const error = new Error("No configured provider could return a verified quote for this stock.");
  error.statusCode = 503;
  error.details = errors;
  error.providerErrors = errors;
  recordQuoteObservation({
    instrumentId: instrument.id,
    provider: errors.at(-1)?.provider ?? null,
    ok: false,
    error,
    quote: null
  });
  throw error;
}

/**
 * Bounded-concurrency map that preserves input order.
 * Replaces the per-endpoint concurrency loops and their fixed sleeps.
 */
export async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length).fill(null);
  const width = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  async function run() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: width }, run));
  return results;
}

/** Batch quotes for a list of instruments; failures are dropped, never faked. */
export async function getVerifiedQuotes(instruments, { concurrency = 4, ...options } = {}) {
  const results = await mapConcurrent(instruments, concurrency, async (instrument) => {
    try {
      return await getVerifiedQuote(instrument, options);
    } catch {
      return null;
    }
  });

  return results.filter(Boolean);
}
