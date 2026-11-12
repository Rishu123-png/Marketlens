/**
 * Token-usage accounting.
 *
 * Counters are per process. That is enough to observe cost per instance, and it
 * is deliberately not treated as billing-grade: once the orchestrator persists
 * agent runs (M5/M8), usage is stored per run and this module becomes a live
 * cache rather than the source of truth.
 *
 * No price table is applied here. Converting tokens to currency requires a
 * provider price list that must be confirmed against current published rates,
 * so this module reports tokens only.
 */

const totals = {
  requests: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0
};

const byAgent = new Map();
const byModel = new Map();

function bump(map, key) {
  if (!map.has(key)) {
    map.set(key, { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  }
  return map.get(key);
}

export function recordUsage({ agent = "unknown", model = "unknown", usage } = {}) {
  const promptTokens = Number(usage?.promptTokens) || 0;
  const completionTokens = Number(usage?.completionTokens) || 0;
  const totalTokens = Number(usage?.totalTokens) || promptTokens + completionTokens;

  for (const bucket of [totals, bump(byAgent, agent), bump(byModel, model)]) {
    bucket.requests += 1;
    bucket.promptTokens += promptTokens;
    bucket.completionTokens += completionTokens;
    bucket.totalTokens += totalTokens;
  }

  return { ...totals };
}

function snapshotMap(map) {
  return Object.fromEntries([...map.entries()].map(([key, value]) => [key, { ...value }]));
}

export function getUsageSnapshot() {
  return {
    totals: { ...totals },
    byAgent: snapshotMap(byAgent),
    byModel: snapshotMap(byModel)
  };
}

export function resetUsageForTests() {
  totals.requests = 0;
  totals.promptTokens = 0;
  totals.completionTokens = 0;
  totals.totalTokens = 0;
  byAgent.clear();
  byModel.clear();
}
