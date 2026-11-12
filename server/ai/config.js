/**
 * Per-agent AI configuration.
 *
 * Model names, temperatures, timeouts and retry counts live here — never inside
 * an agent's prompt code — so a model change is a configuration change. Model
 * identifiers are environment-driven because provider catalogues change; the
 * default below is a starting point, not a guarantee of availability.
 */

import { z } from "zod";
import { AGENT_IDS } from "../../shared/schemas/agent.js";

export const AI_PROVIDER_IDS = ["groq"];

export const DEFAULT_MODEL = "llama-3.3-70b-versatile";

export const aiAgentConfigSchema = z.object({
  agent: z.enum(AGENT_IDS),
  enabled: z.boolean(),
  provider: z.enum(AI_PROVIDER_IDS),
  model: z.string().min(1).max(120),
  temperature: z.number().min(0).max(2),
  maxOutputTokens: z.number().int().min(64).max(8192).nullable(),
  timeoutMs: z.number().int().min(1_000).max(120_000),
  retries: z.number().int().min(0).max(3),
  backoffMs: z.number().int().min(0).max(10_000),
  promptVersion: z.string().min(1).max(32),
  schemaVersion: z.string().min(1).max(32)
});

/**
 * Baseline behaviour per agent. Interpretation-heavy agents run cooler than
 * narrative ones; the coordinator gets a little more room for synthesis.
 */
const BASELINES = Object.freeze({
  chart: { temperature: 0.2, maxOutputTokens: 1200 },
  news: { temperature: 0.2, maxOutputTokens: 1200 },
  sentiment: { temperature: 0.1, maxOutputTokens: 900 },
  technical: { temperature: 0.1, maxOutputTokens: 1200 },
  risk: { temperature: 0.1, maxOutputTokens: 1200 },
  coordinator: { temperature: 0.2, maxOutputTokens: 2400 }
});

function readInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

/** `AI_MODEL_TECHNICAL` overrides `GROQ_MODEL` for one agent. */
export function getModelForAgent(agent, env = process.env) {
  const perAgent = env[`AI_MODEL_${String(agent).toUpperCase()}`];
  return perAgent || env.GROQ_MODEL || DEFAULT_MODEL;
}

export function getAgentConfig(agent, { env = process.env, overrides = {} } = {}) {
  if (!AGENT_IDS.includes(agent)) {
    throw new RangeError(`Unknown agent: ${agent}`);
  }

  const baseline = BASELINES[agent];

  const config = {
    agent,
    enabled: true,
    provider: "groq",
    model: getModelForAgent(agent, env),
    temperature: baseline.temperature,
    maxOutputTokens: baseline.maxOutputTokens,
    timeoutMs: readInteger(env.AI_TIMEOUT_MS, 20_000),
    retries: readInteger(env.AI_RETRIES, 1),
    backoffMs: readInteger(env.AI_BACKOFF_MS, 400),
    promptVersion: "1.0.0",
    schemaVersion: "1.0.0",
    ...overrides
  };

  return aiAgentConfigSchema.parse(config);
}

export function getAllAgentConfigs(options = {}) {
  return AGENT_IDS.map((agent) => getAgentConfig(agent, options));
}
