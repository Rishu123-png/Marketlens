/**
 * Coverage: what the platform can honestly do with the environment it has.
 *
 * The UI and the agents both consume this. It exists so that a missing provider
 * is a stated limitation instead of a silent empty section: every capability is
 * `available`, `partial`, `degraded` or `unavailable`, with the sources behind
 * that judgement and what each one requires.
 */

import { sourceStatuses } from "./registry.js";
import { officialSourceCache } from "./cache.js";
import { healthSnapshot, isFailing } from "./health.js";
import { rssPollingEnabled } from "../news/feeds.js";

export const COVERAGE_VERSION = "1.0.0";

export const CAPABILITIES = Object.freeze({
  quotes: { label: "Quotes", description: "Latest reference price for the instrument." },
  candles: { label: "Historical candles", description: "OHLCV history used for deterministic indicators." },
  news: { label: "News & regulatory context", description: "Headlines and excerpts from official feeds and optional news APIs." },
  filings: { label: "Company filings", description: "Exchange filings or SEC EDGAR documents." },
  nav: { label: "Fund NAV reference", description: "Official end-of-day NAV for funds and ETFs." },
  macro: { label: "Macro / official datasets", description: "Official statistical datasets, not instrument prices." }
});

const CAPABILITY_NOTES = {
  quotes: {
    unavailable: "No quote provider is configured. Research can still run on user-supplied candles.",
    partial: "At least one quote source is configured; free tiers are delayed and rate-limited."
  },
  candles: {
    unavailable: "No candle provider is configured. The platform will not invent OHLCV.",
    degraded: "Only third-party candle vendors are configured; their free tiers are delayed, rate-limited and not exchange-licensed."
  },
  news: {
    available: "Official RSS feeds are polled; reachability of each feed is unverified until it returns entries."
  },
  filings: {
    unavailable: "No filings source is configured. Add SEC_USER_AGENT for US filings or a permitted exchange feed."
  },
  nav: {
    available: "AMFI publishes end-of-day NAV. This is a delayed reference, not a live price."
  },
  macro: {
    unavailable: "data.gov.in is optional and not configured; macro coverage is limited to official feed headlines."
  }
};

function classify(sources) {
  const usable = sources.filter((source) => ["available", "degraded"].includes(source.status));
  const official = usable.filter((source) => source.official);
  // Optional third-party fallbacks are not required coverage: their absence must
  // not demote an official source from "available" to "partial".
  const missing = sources.filter((source) => source.status === "unavailable" && source.optional !== true);
  const prohibited = sources.filter((source) => source.status === "prohibited");

  if (!usable.length) {
    return {
      status: "unavailable",
      reason: missing.length
        ? `Requires configuration: ${missing.map((source) => source.requires ?? source.id).join(", ")}.`
        : "No usable source."
    };
  }

  if (!official.length) {
    return { status: "degraded", reason: "Only third-party or unofficial sources are configured." };
  }

  if (missing.length) {
    return {
      status: "partial",
      reason: `${official.length} official source(s) usable; ${missing.length} more require configuration.`
    };
  }

  return {
    status: "available",
    reason: prohibited.length
      ? `${official.length} official source(s) usable; ${prohibited.length} excluded for terms-of-use reasons.`
      : `${official.length} official source(s) usable.`
  };
}

/**
 * @param {{env?:object, sources?:object[], cache?:object, now?:()=>Date}} options
 */
export function buildCoverage({
  env = process.env,
  sources = sourceStatuses(env),
  cache = officialSourceCache,
  health = healthSnapshot(),
  now = () => new Date()
} = {}) {
  const capabilities = {};

  for (const [id, meta] of Object.entries(CAPABILITIES)) {
    const scoped = sources.filter((source) => source.capability === id);
    const verdict = classify(scoped);
    const liveUnverified = scoped.some(
      (source) => source.kind === "feed" || (source.official && source.id !== "sec-edgar" && source.capability === "news")
    );

    // Runtime reachability can only make coverage worse, never better: a source
    // that is configured but failing must not be advertised as available.
    const usable = scoped.filter((source) => ["available", "degraded"].includes(source.status));
    const failing = usable.filter((source) => isFailing(health[source.id]));
    const observed = usable.filter((source) => Boolean(health[source.id]));
    const runtime =
      failing.length === 0
        ? { state: observed.length ? "healthy" : "unobserved", failingSources: [], lastError: null }
        : failing.length === usable.length
          ? {
              state: "failing",
              failingSources: failing.map((source) => source.id),
              lastError: failing.map((source) => health[source.id]?.lastError).find(Boolean) ?? null
            }
          : {
              state: "partial-failure",
              failingSources: failing.map((source) => source.id),
              lastError: failing.map((source) => health[source.id]?.lastError).find(Boolean) ?? null
            };

    const status = runtime.state === "failing" ? "degraded" : verdict.status;
    const reason =
      runtime.state === "failing"
        ? `Configured sources are failing at runtime: ${runtime.failingSources.join(", ")}.`
        : verdict.reason;

    capabilities[id] = {
      label: meta.label,
      description: meta.description,
      status,
      configuredStatus: verdict.status,
      runtime,
      reason,
      liveVerification: liveUnverified && verdict.status !== "unavailable" ? "unverified" : "not-applicable",
      delayed: id === "nav" || id === "macro" || id === "quotes",
      sources: scoped.map((source) => source.id),
      note: CAPABILITY_NOTES[id]?.[verdict.status] ?? CAPABILITY_NOTES[id]?.available ?? null
    };
  }

  const limitations = [];
  for (const [id, capability] of Object.entries(capabilities)) {
    if (capability.status === "unavailable") limitations.push(`${CAPABILITIES[id].label} unavailable: ${capability.reason}`);
    else if (capability.status === "degraded") limitations.push(`${CAPABILITIES[id].label} degraded: ${capability.reason}`);
  }
  if (!rssPollingEnabled(env)) limitations.push("Official RSS polling is disabled by configuration (NEWS_RSS_ENABLED).");

  const degraded = Object.values(capabilities).some((capability) => capability.status !== "available");

  return {
    version: COVERAGE_VERSION,
    generatedAt: now().toISOString(),
    degraded,
    summary: degraded
      ? "Some evidence sources are limited or unavailable. Reports state their coverage explicitly."
      : "All configured evidence sources are usable.",
    capabilities,
    sources: sources.map((source) => ({
      ...source,
      runtime: health[source.id]
        ? {
            failing: isFailing(health[source.id]),
            lastSuccessAt: health[source.id].lastSuccessAt,
            lastFailureAt: health[source.id].lastFailureAt,
            lastError: health[source.id].lastError
          }
        : null
    })),
    limitations,
    cache: typeof cache?.stats === "function" ? cache.stats() : null
  };
}

/** Compact form embedded in the agent evidence envelope. */
export function coverageSummary(coverage) {
  return {
    version: coverage.version,
    degraded: coverage.degraded,
    capabilities: Object.fromEntries(
      Object.entries(coverage.capabilities).map(([id, capability]) => [
        id,
        { status: capability.status, delayed: capability.delayed, liveVerification: capability.liveVerification }
      ])
    ),
    limitations: coverage.limitations.slice(0, 8)
  };
}
