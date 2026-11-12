/**
 * Runtime reachability memory for official sources.
 *
 * Configuration says a source *should* work. This module records what actually
 * happened on recent requests so coverage can stop calling a source available
 * after it has started failing. It is deliberately in-memory: it is a freshness
 * hint for the current instance, not durable telemetry.
 *
 * Nothing here is used to make a data-quality decision on its own — the
 * publication gate keeps that authority.
 */

const MAX_ERROR_LENGTH = 180;

const state = new Map();

function clip(message) {
  if (!message) return null;
  const text = String(message);
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH - 1)}…` : text;
}

/**
 * @param {string} id Source id (feed id or adapter id).
 * @param {{ok:boolean, error?:string, at?:Date|number}} outcome
 */
export function recordSourceOutcome(id, { ok, error = null, at = new Date() } = {}) {
  if (!id) return;
  const when = at instanceof Date ? at.toISOString() : new Date(at).toISOString();
  const previous = state.get(id) ?? {
    id,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    successes: 0,
    failures: 0,
    consecutiveFailures: 0
  };

  if (ok) {
    previous.lastSuccessAt = when;
    previous.successes += 1;
    previous.consecutiveFailures = 0;
    previous.lastError = null;
  } else {
    previous.lastFailureAt = when;
    previous.failures += 1;
    previous.consecutiveFailures += 1;
    previous.lastError = clip(error);
  }

  state.set(id, previous);
}

export function sourceHealth(id) {
  return state.get(id) ?? null;
}

export function healthSnapshot() {
  return Object.fromEntries(state.entries());
}

/** A source is "failing" when it has failed more recently than it succeeded. */
export function isFailing(health) {
  if (!health) return false;
  if (!health.lastFailureAt) return false;
  if (!health.lastSuccessAt) return true;
  return Date.parse(health.lastFailureAt) > Date.parse(health.lastSuccessAt);
}

export function resetSourceHealthForTests() {
  state.clear();
}

/** Mark every feed outcome from one provider search in a single call. */
export function recordFeedOutcomes(results) {
  for (const result of results ?? []) {
    recordSourceOutcome(result.feed, { ok: result.ok, error: result.error ?? null });
  }
}
