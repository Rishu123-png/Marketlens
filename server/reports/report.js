/**
 * Report assembly.
 *
 * The coordinator writes the narrative sections, but this module decides which
 * sections are allowed to be available. If a specialist did not complete, its
 * section is overwritten with an explicit unavailable notice — coordinator text
 * for that section is discarded rather than trusted. Instrument identity,
 * sources and methodology are generated deterministically from the evidence
 * envelope, never by a model.
 */

import { createHash } from "node:crypto";
import { researchReportSchema } from "../../shared/schemas/research.js";
import { ENVELOPE_VERSION } from "../agents/envelope.js";
import { PATTERN_ENGINE_VERSION } from "../patterns/index.js";
import { INDICATOR_ENGINE_VERSION } from "../indicators/index.js";
import { MARKET_DATA_REGISTRY_VERSION } from "../market-data/registry.js";

export const REPORT_BUILDER_VERSION = "1.0.0";

const SECTION_SOURCE = {
  marketContext: "market-context",
  chart: "chart",
  technical: "technical",
  news: "news",
  sentiment: "sentiment",
  risk: "risk",
  conflicts: null
};

function shortHash(input) {
  return createHash("sha256").update(String(input)).digest("hex").slice(0, 16);
}

function unavailable(reason) {
  return { status: "unavailable", body: reason };
}

function agentStatusMap(agentRuns) {
  return Object.fromEntries(Object.entries(agentRuns).map(([agent, run]) => [agent, run.status]));
}

function instrumentSection(instrument, envelope) {
  if (!instrument) return "Instrument identity could not be resolved.";
  const quote = envelope?.marketContext?.quote;
  const freshness = quote?.freshness;
  const quoteLine = quote
    ? `Verified quote: ${quote.price} ${quote.currency ?? instrument.currency ?? ""} via ${quote.provider}` +
      ` · provider timestamp ${quote.providerTimestamp ?? "unavailable"} · retrieved ${quote.retrievedAt}` +
      ` · freshness ${typeof freshness === "string" ? freshness : "unknown"}`
    : "Verified quote: none. No provider returned a quote whose identity matched this instrument.";
  return [
    `${instrument.name ?? instrument.symbol} (${instrument.symbol})`,
    `Exchange: ${instrument.exchange ?? "unknown"} · Country: ${instrument.country ?? "unknown"} · Currency: ${instrument.currency ?? "unknown"}`,
    `Asset type: ${instrument.assetType ?? "unknown"} · Sector: ${instrument.sector ?? "unclassified"}`,
    quoteLine,
    `Instrument id: ${instrument.id}`
  ].join("\n");
}

function scenarioLine(label, scenario) {
  const evidence = scenario.evidenceIds?.length ? scenario.evidenceIds.join(", ") : "no direct evidence id";
  return [
    `${label}: ${scenario.thesis}`,
    `Evidence: ${evidence}. Uncertainty: ${scenario.uncertainty}.`,
    scenario.conditions?.length ? `Conditions: ${scenario.conditions.join("; ")}.` : null,
    scenario.invalidation ? `Invalidation: ${scenario.invalidation}.` : null
  ]
    .filter(Boolean)
    .join("\n");
}

function scenarioSection(coordinator) {
  if (!coordinator?.scenarios) {
    return "Scenarios unavailable: the coordinator did not return bullish, bearish and neutral readings. This is not evidence that any scenario is more likely.";
  }
  return [
    scenarioLine("Bullish scenario", coordinator.scenarios.bullish),
    scenarioLine("Bearish scenario", coordinator.scenarios.bearish),
    scenarioLine("Neutral scenario", coordinator.scenarios.neutral),
    "These are conditional interpretations of the same supplied evidence, not forecasts, probabilities or recommendations."
  ].join("\n\n");
}

function sourceLines(envelope) {
  const items = envelope?.evidence?.items || [];
  if (!items.length) return ["No external sources were used in this report."];

  return items.map((item) => {
    const published = item.publishedAt ? ` (published ${item.publishedAt})` : " (publication time unavailable)";
    const title = item.excerpt ? `${item.excerpt.slice(0, 120)}${item.excerpt.length > 120 ? "…" : ""}` : "No excerpt";
    return `${item.publisher} — "${title}"${published} — ${item.url ?? "no url"} [${item.evidenceId}]`;
  });
}

function methodologySection({ depth, modules, envelope, quote, gate, agentRuns }) {
  return [
    `Depth: ${depth}. Modules: ${modules.join(", ")}.`,
    `Market data: ${quote ? `${quote.provider} quote retrieved ${quote.retrievedAt}` : "no verified quote"}; ` +
      `candles ${envelope?.marketContext?.candles?.count ?? 0} (${envelope?.marketContext?.candles?.source ?? "no provider"}).`,
    `Calculations: indicator engine ${INDICATOR_ENGINE_VERSION}, pattern engine ${PATTERN_ENGINE_VERSION}.`,
    `Market-data registry ${MARKET_DATA_REGISTRY_VERSION}; provider tier is delayed/EOD unless a validated entitlement says otherwise.`,
    `Agents: ${Object.entries(agentRuns).map(([agent, run]) => `${agent}=${run.status}`).join(", ")}.`,
    `Publication gate: ${gate.verdict} under rules ${gate.rulesVersion}.`,
    `Evidence envelope ${ENVELOPE_VERSION}, report builder ${REPORT_BUILDER_VERSION}.`,
    "All prices are provider-reported and delayed by the provider's own latency. Research and educational use only; no order execution."
  ].join("\n");
}

/**
 * @param {{instrument:object, depth:string, jobId:string|null, modules:string[],
 *   agentRuns:Record<string,object>, gate:object, envelope:object, coordinatorOutput:object|null,
 *   quote:object|null, createdAt?:string}} input
 */
export function buildResearchReport(input) {
  const {
    instrument,
    depth,
    modules,
    agentRuns,
    gate,
    envelope,
    coordinatorOutput,
    quote = null,
    createdAt = new Date().toISOString()
  } = input;

  const jobId = /^research_[a-z0-9]{8,}$/.test(input.jobId || "")
    ? input.jobId
    : `research_${shortHash(`${instrument?.id}|${depth}|${createdAt}`)}`;

  const coordinator = agentRuns.coordinator?.status === "COMPLETED" ? coordinatorOutput : null;
  const sections = {};

  sections.executiveSummary = coordinator
    ? coordinator.sections.summary.body
    : "The coordinator did not complete, so no synthesised summary is available. Individual module findings below are unchanged and the publication verdict is determined by the deterministic gate.";

  sections.instrument = instrumentSection(instrument, envelope);

  for (const [section, source] of Object.entries(SECTION_SOURCE)) {
    if (source === null) {
      sections.conflicts = coordinator
        ? coordinator.sections.conflicts.body
        : agentRuns.risk?.output?.conflicts?.length
          ? agentRuns.risk.output.conflicts.join("\n")
          : "No conflicts were reported by the specialists.";
      continue;
    }

    if (!modules.includes(source)) {
      sections[section] = `Not analysed: the ${depth} depth does not request the ${source} module.`;
      continue;
    }

    const run = agentRuns[source];
    const sectionNames = {
      "market-context": "marketContext",
      chart: "chart",
      technical: "technical",
      news: "news",
      sentiment: "sentiment",
      risk: "risk"
    };
    const sectionName = sectionNames[source];

    if (!run || run.status !== "COMPLETED") {
      sections[section] = `Section unavailable: the ${source} agent did not complete (${run?.status ?? "not run"}).`;
      continue;
    }

    if (!coordinator) {
      // The specialist ran but synthesis failed: fall back to its own summary
      // rather than leaving a hole or inventing prose.
      sections[section] = run.output?.summary ?? `Section unavailable: no summary was returned by the ${source} agent.`;
      continue;
    }

    if (sectionName === "chart" || sectionName === "technical" || sectionName === "news" || sectionName === "sentiment" || sectionName === "risk" || sectionName === "marketContext") {
      sections[section] = coordinator.sections[sectionName]?.body ?? `Section unavailable: the coordinator returned no ${sectionName} section.`;
    }
  }

  sections.scenarios = scenarioSection(coordinator);
  sections.observations = coordinator ? [...coordinator.observations] : [];
  sections.limitations = [
    ...(coordinator?.limitations || []),
    ...(envelope?.evidence?.limitations || []),
    "Historical calculations and reported evidence do not predict future prices.",
    ...gate.warnings.map((warning) => `${warning.rule}: ${warning.message}`)
  ];
  sections.sources = sourceLines(envelope);
  sections.methodology = methodologySection({ depth, modules, envelope, quote, gate, agentRuns });

  const report = {
    reportId: `report_${shortHash(`${jobId}|${gate.verdict}|${createdAt}`)}`,
    jobId,
    instrumentId: instrument.id,
    depth,
    sections,
    agentStatus: agentStatusMap(agentRuns),
    evidenceIds: (envelope?.evidence?.items || []).map((item) => item.evidenceId).slice(0, 500),
    gate,
    methodology: sections.methodology,
    createdAt
  };

  const parsed = researchReportSchema.safeParse(report);
  if (!parsed.success) {
    const error = new Error("Report assembly produced an invalid report.");
    error.statusCode = 500;
    error.details = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    }));
    throw error;
  }

  return parsed.data;
}
