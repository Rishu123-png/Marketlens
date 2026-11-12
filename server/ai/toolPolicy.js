/**
 * Which specialist agents may call deterministic tools, and which tools.
 *
 * Tool calling is a licence to *read the run's evidence again*, not to widen it.
 * The `get_*` tools are the controlled interface: quote, historical candles,
 * instrument identity, deterministic indicators, company news, market events
 * and a data-quality overview. No tool can fetch, browse or write.
 *
 * `AI_TOOL_CALLING=off` disables tool use everywhere without a code change.
 */

import { createToolContext, toolDefinitionsFor } from "../agents/tools.js";

export const DEFAULT_TOOL_AGENTS = Object.freeze(["chart", "news", "sentiment"]);

const TOOLS_BY_AGENT = Object.freeze({
  chart: ["get_quote", "get_historical_candles", "get_instrument_info"],
  news: ["get_company_news", "get_market_events"],
  sentiment: ["get_company_news", "get_market_events"],
  technical: ["get_technical_indicators", "get_historical_candles"],
  risk: ["get_quote", "get_historical_candles", "get_market_overview"],
  coordinator: []
});

export function toolCallingEnabled(env = process.env) {
  const flag = String(env.AI_TOOL_CALLING ?? "on").toLowerCase();
  return !["off", "false", "0", "disabled"].includes(flag);
}

export function toolAgentIds(env = process.env) {
  const configured = String(env.AI_TOOL_AGENTS ?? "").trim();
  if (!configured) return [...DEFAULT_TOOL_AGENTS];
  const requested = configured
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => Object.hasOwn(TOOLS_BY_AGENT, value));
  return requested.length ? [...new Set(requested)] : [...DEFAULT_TOOL_AGENTS];
}

/**
 * Resolve tools + read-only context for one agent run.
 * Returns `{ tools: null, context: null }` when tools are off for the agent.
 */
export function toolsForAgent(agent, envelope, env = process.env) {
  if (!toolCallingEnabled(env)) return { tools: null, context: null };
  if (!toolAgentIds(env).includes(agent)) return { tools: null, context: null };

  const names = TOOLS_BY_AGENT[agent] ?? [];
  const tools = toolDefinitionsFor(names);
  if (!tools.length) return { tools: null, context: null };

  return { tools, context: createToolContext(envelope) };
}
