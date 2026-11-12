/**
 * AI diagnostics: credential routing, model configuration and execution
 * telemetry. Contains no secret values, prefixes or Authorization headers.
 */

import { AGENT_IDS } from "../../shared/schemas/agent.js";
import { getAgentConfig } from "./config.js";
import { describeGroqCredentials } from "./credentials.js";
import { agentTelemetrySnapshot } from "./telemetry.js";
import { getUsageSnapshot } from "./usage.js";

export function buildAiDiagnostics({ env = process.env, limit = 60 } = {}) {
  const credentials = describeGroqCredentials(env);
  const usage = getUsageSnapshot();
  const telemetry = agentTelemetrySnapshot({ limit });

  const agents = Object.fromEntries(
    AGENT_IDS.map((agent) => {
      let config = null;
      try {
        config = getAgentConfig(agent, { env });
      } catch {
        config = null;
      }
      return [
        agent,
        {
          agent,
          model: config?.model ?? null,
          provider: config?.provider ?? "groq",
          credential: credentials.agents[agent],
          usage: usage.byAgent[agent] ?? { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          recentRuns: telemetry.runs.filter((run) => run.agent === agent).slice(0, 10)
        }
      ];
    })
  );

  return {
    generatedAt: new Date().toISOString(),
    provider: "groq",
    separation:
      "This panel describes AI credentials and executions only. Market-data coverage is measured separately by provider requests and verified candles/quotes.",
    credentials,
    agents,
    usage: usage.totals,
    recentRuns: telemetry.runs,
    telemetry: { persisted: telemetry.persisted, note: telemetry.note, count: telemetry.count },
    notes: [
      "Credential values are never returned. Only environment-variable names and dedicated/shared mode are shown.",
      "Separate keys isolate credentials and per-key accounting; they do not multiply Groq organisation/project limits.",
      "A configured credential is not a successful live call. Success is recorded per agent run."
    ]
  };
}
