import { createHash } from "node:crypto";

const windows = new Map();
const REDIS_SCRIPT = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return {n,redis.call('TTL',KEYS[1])}";

function getClientKey(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  const forwardedIp = Array.isArray(forwarded)
    ? forwarded[0]
    : String(forwarded || "").split(",")[0].trim();
  return forwardedIp || req.socket?.remoteAddress || "unknown";
}

function memoryRateLimit(key, limit, windowMs) {
  const now = Date.now();
  let entry = windows.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    windows.set(key, entry);
  }
  entry.count += 1;

  if (windows.size > 10_000) {
    for (const [storedKey, stored] of windows) {
      if (now >= stored.resetAt) windows.delete(storedKey);
    }
  }
  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
  };
}

async function redisRateLimit(key, limit, windowMs) {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${url}/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify([
        "EVAL",
        REDIS_SCRIPT,
        "1",
        key,
        String(Math.max(1, Math.ceil(windowMs / 1000)))
      ]),
      signal: controller.signal
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const [count, ttl] = payload?.result || [];
    if (!Number.isFinite(Number(count))) return null;
    return {
      allowed: Number(count) <= limit,
      remaining: Math.max(0, limit - Number(count)),
      retryAfterSeconds: Math.max(1, Number(ttl) || Math.ceil(windowMs / 1000))
    };
  } catch {
    // Fail over to local limiting if the shared store is temporarily unavailable.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Shared Redis limiter when configured; otherwise a best-effort per-instance fallback. */
export async function rateLimit(req, { name, limit, windowMs }) {
  const client = getClientKey(req);
  const digest = createHash("sha256").update(client).digest("hex").slice(0, 32);
  const key = `marketlens:ratelimit:${name}:${digest}`;
  return (await redisRateLimit(key, limit, windowMs)) || memoryRateLimit(key, limit, windowMs);
}

export function resetRateLimitsForTests() {
  windows.clear();
}
