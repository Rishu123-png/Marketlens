/**
 * Provider quota and circuit-breaker policy for market-data requests.
 *
 * Goal: a chart refresh must not burn a provider's remaining credits after it
 * has already said "quota exhausted". State is tracked per provider and is
 * optionally shared through Upstash Redis when it is configured. Without Redis
 * the state is per serverless instance and the diagnostics say so.
 *
 * Nothing in this module stores credentials, request URLs or response bodies.
 */

import { redisCommand, redisConfigured } from "../../lib/server/redisRest.js";

const KEY_PREFIX = "marketlens:provider-policy:";
const STORE_TTL_SECONDS = 7 * 24 * 60 * 60;
const MEMORY_SYNC_MS = 5_000;

const states = new Map();

function emptyState(providerId) {
  return {
    providerId,
    openUntil: null,
    consecutiveFailures: 0,
    lastOutcome: null,
    lastHttpStatus: null,
    lastReason: null,
    lastError: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    retryAfterSeconds: null,
    quota: null,
    updatedAt: 0
  };
}

function stateFor(providerId) {
  if (!states.has(providerId)) states.set(providerId, emptyState(providerId));
  return states.get(providerId);
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function headerValue(headers, names) {
  if (!headers) return null;
  for (const name of names) {
    const value = headers.get?.(name) ?? headers[name];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

/** Extract only quota-shaped response metadata. Never stores other headers. */
export function quotaFromHeaders(headers) {
  if (!headers) return null;
  const remaining = finite(
    headerValue(headers, ["x-ratelimit-remaining-requests", "x-ratelimit-remaining", "api-credits-left", "x-api-credits-left"])
  );
  const limit = finite(
    headerValue(headers, ["x-ratelimit-limit-requests", "x-ratelimit-limit", "api-credits-limit", "x-api-credits-limit"])
  );
  const used = finite(headerValue(headers, ["api-credits-used", "x-api-credits-used"]));
  const reset = headerValue(headers, ["x-ratelimit-reset-requests", "x-ratelimit-reset", "api-credits-reset", "x-api-credits-reset"]);
  if ([remaining, limit, used, reset].every((value) => value === null)) return null;
  return {
    remainingRequests: remaining,
    limitRequests: limit,
    usedCredits: used,
    reset: reset === null ? null : String(reset).slice(0, 80)
  };
}

function retryAfterFrom(error, headers) {
  const explicit = finite(error?.retryAfterSeconds) ?? finite(headerValue(headers, ["retry-after"]));
  return explicit !== null && explicit >= 0 ? explicit : null;
}

function untilNextUtcDay(nowMs) {
  const now = new Date(nowMs);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5, 0);
}

function classify(error, nowMs, providerId) {
  const status = finite(error?.status);
  const message = String(error?.message ?? "").toLowerCase();
  const retryAfter = retryAfterFrom(error, error?.headers);

  if (status === 429) {
    if (/per day|daily|for the day|requests per day|next day|daily limit/.test(message)) {
      return { reason: "quota-exhausted", openUntil: untilNextUtcDay(nowMs), retryAfterSeconds: Math.ceil((untilNextUtcDay(nowMs) - nowMs) / 1000) };
    }
    const seconds = retryAfter ?? 60;
    return { reason: "rate-limited", openUntil: nowMs + seconds * 1000, retryAfterSeconds: seconds };
  }
  if (status === 401 || status === 403) {
    return { reason: "permission-or-endpoint", openUntil: nowMs + 6 * 60 * 60 * 1000, retryAfterSeconds: 6 * 60 * 60 };
  }
  if (status !== null && status >= 500) {
    const failures = stateFor(providerId).consecutiveFailures + 1;
    const seconds = Math.min(15 * 60, 30 * 2 ** Math.min(5, failures - 1));
    return { reason: "transient-upstream", openUntil: nowMs + seconds * 1000, retryAfterSeconds: seconds };
  }
  if (error?.name === "AbortError" || /timed out|timeout/.test(message)) {
    const failures = stateFor(providerId).consecutiveFailures + 1;
    const seconds = Math.min(5 * 60, 15 * 2 ** Math.min(5, failures - 1));
    return { reason: "timeout", openUntil: nowMs + seconds * 1000, retryAfterSeconds: seconds };
  }
  return null;
}

async function syncFromRedis(providerId, nowMs) {
  if (!redisConfigured()) return;
  const local = stateFor(providerId);
  if (nowMs - (local.syncedAt ?? 0) < MEMORY_SYNC_MS) return;
  local.syncedAt = nowMs;
  try {
    const raw = await redisCommand(["GET", `${KEY_PREFIX}${providerId}`]);
    if (typeof raw !== "string" || !raw) return;
    const remote = JSON.parse(raw);
    if (!remote || typeof remote !== "object") return;
    if (Number(remote.updatedAt) > Number(local.updatedAt)) {
      states.set(providerId, { ...emptyState(providerId), ...remote, syncedAt: nowMs });
    }
  } catch {
    // A policy-store outage must not make market data unavailable.
  }
}

async function save(providerId) {
  const state = stateFor(providerId);
  state.updatedAt = Date.now();
  if (!redisConfigured()) return;
  try {
    await redisCommand([
      "SET",
      `${KEY_PREFIX}${providerId}`,
      JSON.stringify({ ...state, syncedAt: undefined }),
      "EX",
      String(STORE_TTL_SECONDS)
    ]);
  } catch {
    // Keep the local state.
  }
}

/**
 * @returns {Promise<{allowed:boolean, reason:string|null, retryAfterSeconds:number|null}>}
 */
export async function checkProvider(providerId, { now = Date.now() } = {}) {
  await syncFromRedis(providerId, now);
  const state = stateFor(providerId);
  if (state.openUntil && Number(state.openUntil) > now) {
    return {
      allowed: false,
      reason: state.lastReason || "circuit-open",
      retryAfterSeconds: Math.max(1, Math.ceil((Number(state.openUntil) - now) / 1000))
    };
  }
  if (state.openUntil && Number(state.openUntil) <= now) {
    state.openUntil = null;
    state.lastReason = null;
    state.retryAfterSeconds = null;
    await save(providerId);
  }
  return { allowed: true, reason: null, retryAfterSeconds: null };
}

export async function recordProviderSuccess(providerId, { headers = null, now = Date.now() } = {}) {
  const state = stateFor(providerId);
  state.lastOutcome = "success";
  state.lastHttpStatus = 200;
  state.lastReason = null;
  state.lastError = null;
  state.consecutiveFailures = 0;
  state.openUntil = null;
  state.retryAfterSeconds = null;
  state.lastAttemptAt = new Date(now).toISOString();
  state.lastSuccessAt = state.lastAttemptAt;
  const quota = quotaFromHeaders(headers);
  if (quota) state.quota = quota;
  await save(providerId);
}

export async function recordProviderFailure(providerId, error, { headers = null, now = Date.now() } = {}) {
  const state = stateFor(providerId);
  const status = finite(error?.status);
  const message = String(error?.message ?? "Provider failed.").slice(0, 240);
  state.lastOutcome = "failure";
  state.lastHttpStatus = status;
  state.lastAttemptAt = new Date(now).toISOString();
  state.lastError = message;
  state.consecutiveFailures += 1;
  const quota = quotaFromHeaders(headers);
  if (quota) state.quota = quota;

  const failure = classify(error, now, providerId);
  if (failure) {
    state.lastReason = failure.reason;
    state.retryAfterSeconds = failure.retryAfterSeconds;
    state.openUntil = Math.max(Number(state.openUntil) || 0, failure.openUntil);
  }
  await save(providerId);
}

export function providerPolicySnapshot({ now = Date.now() } = {}) {
  return {
    shared: redisConfigured(),
    note: redisConfigured()
      ? "Provider quota/circuit state is shared through Upstash Redis."
      : "Provider quota/circuit state is per serverless instance; a cold start can make one new attempt.",
    providers: Object.fromEntries(
      [...states.values()].map((state) => [
        state.providerId,
        {
          circuit: state.openUntil && Number(state.openUntil) > now ? "open" : "closed",
          openUntil: state.openUntil && Number(state.openUntil) > now ? new Date(Number(state.openUntil)).toISOString() : null,
          retryAfterSeconds:
            state.openUntil && Number(state.openUntil) > now
              ? Math.max(1, Math.ceil((Number(state.openUntil) - now) / 1000))
              : null,
          reason: state.lastReason,
          lastOutcome: state.lastOutcome,
          lastHttpStatus: state.lastHttpStatus,
          lastError: state.lastError,
          consecutiveFailures: state.consecutiveFailures,
          lastAttemptAt: state.lastAttemptAt,
          lastSuccessAt: state.lastSuccessAt,
          quota: state.quota
        }
      ])
    )
  };
}

export function resetProviderPolicyForTests() {
  states.clear();
}
