import { chartAgent } from "./chart.js";
import { technicalAgent } from "./technical.js";
import { newsAgent } from "./news.js";
import { sentimentAgent } from "./sentiment.js";
import { riskAgent } from "./risk.js";
import { coordinatorAgent } from "./coordinator.js";

export const SPECIALIST_AGENTS = [chartAgent, technicalAgent, newsAgent, sentimentAgent, riskAgent];
export const COORDINATOR_AGENT = coordinatorAgent;

export const AGENT_MODULES = Object.freeze({
  chart: chartAgent,
  technical: technicalAgent,
  news: newsAgent,
  sentiment: sentimentAgent,
  risk: riskAgent,
  coordinator: coordinatorAgent
});

export function getAgentModule(agent) {
  return AGENT_MODULES[agent] || null;
}

/** Agents that must run in parallel before risk and the coordinator. */
export function parallelAgentsForDepth(depth) {
  const base = ["chart", "technical"];
  if (depth === "standard" || depth === "comprehensive") base.push("news");
  if (depth === "comprehensive") base.push("sentiment");
  return base;
}
