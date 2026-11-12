/**
 * Bounded, secret-free AI execution telemetry.
 *
 * This is operational visibility, not billing-grade accounting and not a
 * durable store. It records only names, counts and timings — never credentials,
 * prefixes or upstream request URLs.
 */

const MAX_RUNS = 500;
const runs = [];

function numberOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function recordAgentTelemetry(run = {}) {
  if (!run.agent) return null;
  const entry = {
    at: run.completedAt || new Date().toISOString(),
    agent: run.agent,
    status: run.status ?? null,
    provider: run.provider ?? null,
    model: run.model ?? null,
    credentialEnvName: run.credentialEnvName ?? null,
    credentialMode: run.credentialMode ?? "none",
    requestCount: numberOrNull(run.requestCount) ?? 0,
    retries: numberOrNull(run.retries) ?? 0,
    attempts: numberOrNull(run.attempts) ?? 0,
    promptTokens: numberOrNull(run.usage?.promptTokens),
    completionTokens: numberOrNull(run.usage?.completionTokens),
    totalTokens: numberOrNull(run.usage?.totalTokens),
    durationMs: numberOrNull(run.durationMs),
    httpStatus: numberOrNull(run.httpStatus),
    rateLimit: run.rateLimit ?? null,
    failureReason: run.status === "FAILED" ? (run.error || "Agent failed.").slice(0, 300) : null,
    modelFallback: run.modelFallback ?? null
  };

  runs.push(entry);
  if (runs.length > MAX_RUNS) runs.splice(0, runs.length - MAX_RUNS);
  return entry;
}

export function agentTelemetrySnapshot({ agent = null, limit = 100 } = {}) {
  const selected = agent ? runs.filter((entry) => entry.agent === agent) : runs;
  return {
    persisted: false,
    note: "Per-process AI telemetry; resets on cold start. No credential values are stored.",
    count: selected.length,
    runs: selected.slice(-Math.max(1, Math.min(200, Number(limit) || 100))).reverse()
  };
}

export function resetAgentTelemetryForTests() {
  runs.length = 0;
}
