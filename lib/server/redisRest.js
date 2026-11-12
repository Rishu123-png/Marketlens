/**
 * Minimal Upstash Redis REST client for server-side policy state.
 *
 * Only used for non-secret operational metadata (provider quotas/circuits).
 * Returns null when Redis is not configured or unavailable; callers fall back
 * to per-process state. Secrets are read from the environment and never logged.
 */

export function redisConfigured(env = process.env) {
  return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}

/**
 * @param {Array<string|number>} command Redis command array, e.g. ["GET","key"].
 * @returns {Promise<any|null>} The `result` field, or null on any failure.
 */
export async function redisCommand(command, { env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 1500 } = {}) {
  if (!redisConfigured(env)) return null;
  const url = env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(command),
      signal: controller.signal
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.result ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
