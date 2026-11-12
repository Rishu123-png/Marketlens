/**
 * Research orchestrator — the hybrid execution model.
 *
 * Deterministic steps first: quote → candles → indicators → chart structure →
 * evidence. Then specialist agents in parallel, then risk (which sees the other
 * specialists), then the deterministic gate, then the coordinator (which sees
 * the gate). Data collection and the gate are code; agents only interpret what
 * the code produced.
 *
 * Failure is recorded, not repaired: a specialist that cannot run is reported
 * SKIPPED with reasons, an invalid or prohibited output is FAILED, and the
 * report builder removes that section.
 */

import { REQUIRED_MODULES_BY_DEPTH, RESEARCH_DEPTHS } from "../../shared/schemas/research.js";
import { agentRunSchema } from "../../shared/schemas/agent.js";
import { getInstrument, instrumentFromSymbol } from "../../shared/instruments/catalog.js";
import { getCandles } from "../market-data/candles.js";
import { getVerifiedQuote } from "../market-data/gateway.js";
import { gatherEvidence } from "../news/service.js";
import { INDICATOR_ENGINE_VERSION, indicatorSnapshot } from "../indicators/index.js";
import { PATTERN_ENGINE_VERSION, analyzeChart } from "../patterns/index.js";
import { STRUCTURE_ENGINE_VERSION, analyzeMarketStructure } from "../patterns/structure.js";
import { AGENT_MODULES, parallelAgentsForDepth } from "../agents/index.js";
import { ENVELOPE_VERSION, buildEvidenceEnvelope, evidenceIdsOf } from "../agents/envelope.js";
import { PROMPT_ENVELOPE_VERSION } from "../agents/prompt.js";
import { validateAgentOutput } from "../agents/guard.js";
import { runAgent } from "../ai/runAgent.js";
import { buildCoverage, coverageSummary } from "../evidence/coverage.js";
import { toolsForAgent } from "../ai/toolPolicy.js";
import { groqProvider } from "../ai/providers/groq.js";
import { getAgentConfig } from "../ai/config.js";
import { safeEvaluatePublicationGate } from "../reports/gate.js";
import { GATE_RULES_VERSION } from "../../shared/schemas/gate.js";
import { REPORT_BUILDER_VERSION, buildResearchReport } from "../reports/report.js";
import {
  REPRODUCIBILITY_VERSION,
  buildDataSnapshot,
  buildRunConfig
} from "./reproducibility.js";

export const ORCHESTRATOR_VERSION = "1.0.0";

const CANDLE_LIMIT = 260;
const EVIDENCE_LIMIT = { quick: 0, standard: 12, comprehensive: 20 };

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function resolveInstrument(target, exchange) {
  if (target && typeof target === "object") return target;
  if (target) {
    const known = getInstrument(target);
    if (known) return known;
  }
  return instrumentFromSymbol(target, exchange);
}

function errorMessage(error) {
  return error instanceof Error ? error.message.slice(0, 300) : "Unknown failure";
}

function skippedRun(agent, reason, { now, instrumentId, jobId, config }) {
  const at = now().toISOString();
  return agentRunSchema.parse({
    agent,
    status: "SKIPPED",
    researchJobId: jobId ?? null,
    instrumentId: instrumentId ?? null,
    startedAt: at,
    completedAt: at,
    durationMs: 0,
    attempts: 0,
    retries: 0,
    provider: config?.provider ?? null,
    model: config?.model ?? null,
    promptVersion: config?.promptVersion ?? "unknown",
    schemaVersion: config?.schemaVersion ?? "unknown",
    output: null,
    error: `Insufficient evidence: ${reason}`,
    usage: null
  });
}

function failedRun(agent, error, { now, instrumentId, jobId, config, previous }) {
  const at = now().toISOString();
  return agentRunSchema.parse({
    agent,
    status: "FAILED",
    researchJobId: jobId ?? null,
    instrumentId: instrumentId ?? null,
    startedAt: previous?.startedAt ?? at,
    completedAt: at,
    durationMs: previous?.durationMs ?? 0,
    attempts: previous?.attempts ?? 0,
    retries: previous?.retries ?? 0,
    provider: previous?.provider ?? config?.provider ?? null,
    model: previous?.model ?? config?.model ?? null,
    promptVersion: config?.promptVersion ?? "unknown",
    schemaVersion: config?.schemaVersion ?? "unknown",
    output: null,
    error: String(error).slice(0, 2000),
    usage: null
  });
}

async function collectMarketData({ instrument, options, warnings }) {
  const quote =
    options.quote ??
    (await withWarning(warnings, "quote", () => getVerifiedQuote(instrument, { exchange: instrument.exchange })));

  const crossQuotes = [];
  const secondary = options.secondaryProvider ?? process.env.SECONDARY_MARKET_PROVIDER;
  if (quote && secondary && secondary !== quote.provider) {
    const second = await withWarning(warnings, "cross-quote", () =>
      getVerifiedQuote(instrument, { primary: secondary, cache: false })
    );
    if (second) crossQuotes.push({ provider: second.provider, price: second.price });
    if (quote.quoteVerified === true) crossQuotes.unshift({ provider: quote.provider, price: quote.price });
  }

  const candles =
    options.candles ??
    (await withWarning(warnings, "candles", () =>
      getCandles(instrument, { interval: options.interval ?? "1day", limit: options.candleLimit ?? CANDLE_LIMIT })
    ));

  let indicators = null;
  let chart = null;
  let structure = null;

  if (candles?.candles?.length) {
    indicators = await withWarning(warnings, "indicators", async () => indicatorSnapshot(candles.candles));
    chart = await withWarning(warnings, "chart", async () => analyzeChart(candles.candles));
    structure = await withWarning(warnings, "structure", async () =>
      analyzeMarketStructure(candles.candles, { interval: candles.interval })
    );
  }

  return { quote, crossQuotes, candles, indicators, chart, structure };
}

async function withWarning(warnings, label, fn) {
  try {
    return await fn();
  } catch (error) {
    warnings.push(`${label}: ${errorMessage(error)}`);
    return null;
  }
}

async function collectEvidence({ instrument, depth, options, warnings }) {
  const limit = EVIDENCE_LIMIT[depth] ?? 0;
  if (!limit) return null;

  const evidence = await withWarning(warnings, "evidence", () =>
    gatherEvidence({ instrument, limit, sinceDays: options.newsLookbackDays ?? 7, cache: options.cacheEvidence })
  );

  return evidence ?? null;
}

async function executeAgent({
  agent,
  envelope,
  context,
  provider,
  configOverrides,
  jobId,
  instrumentId,
  now,
  onAgentRun
}) {
  const module = AGENT_MODULES[agent];
  const config = getAgentConfig(agent, { overrides: configOverrides?.[agent] || {} });
  const missing = module.precheck(envelope);

  if (missing.length) {
    const run = skippedRun(agent, missing.join("; "), { now, instrumentId, jobId, config });
    onAgentRun?.(agent, run);
    return run;
  }

  const tooling = toolsForAgent(agent, envelope);

  let run;
  try {
    run = await runAgent({
      agent,
      messages: module.buildMessages(envelope, context),
      schema: module.schema,
      config,
      provider,
      jobId,
      instrumentId,
      now,
      tools: tooling.tools,
      toolContext: tooling.context
    });
  } catch (error) {
    run = failedRun(agent, errorMessage(error), { now, instrumentId, jobId, config });
  }

  if (run.status === "COMPLETED") {
    const validation = validateAgentOutput(run.output, { allowedEvidenceIds: evidenceIdsOf(envelope) });
    if (!validation.ok) {
      const reasons = [
        ...validation.prohibited.map((violation) => `prohibited language (${violation.rule}): "${violation.excerpt}"`),
        ...validation.unknownEvidenceIds.map((id) => `cited unknown evidence id: ${id}`)
      ];
      run = failedRun(agent, `Output rejected: ${reasons.join("; ")}`, {
        now,
        instrumentId,
        jobId,
        config,
        previous: run
      });
    }
  }

  onAgentRun?.(agent, run);
  return run;
}

function riskWarningsOf(riskRun) {
  if (riskRun?.status !== "COMPLETED") return [];
  return [
    ...(riskRun.output.gateReasons || []),
    ...(riskRun.output.dataQuality?.warnings || [])
  ];
}

/**
 * @param {object} options
 * @param {string|object} options.instrument Instrument id, symbol or catalog object.
 * @param {"quick"|"standard"|"comprehensive"} [options.depth]
 * @param {object} [options.quote] Pre-fetched verified quote (worker reuse).
 * @param {object} [options.candles] Pre-fetched candle series.
 * @param {object|null} [options.evidence] Pre-fetched evidence envelope section.
 * @param {Function} [options.provider] AI provider adapter (tests inject a stub).
 * @param {string|null} [options.jobId]
 * @param {Function} [options.now]
 * @param {(agent:string, run:object)=>void} [options.onAgentRun]
 */
export async function runResearch(options = {}) {
  const depth = options.depth ?? "quick";
  if (!RESEARCH_DEPTHS.includes(depth)) {
    throw badRequest(`Unsupported depth. Supported: ${RESEARCH_DEPTHS.join(", ")}`);
  }

  const instrument = resolveInstrument(options.instrument ?? options.symbol, options.exchange);
  if (!instrument?.id) throw badRequest("A valid instrument symbol is required for research.");

  const now = options.now ?? (() => new Date());
  const provider = options.provider ?? groqProvider;
  const jobId = options.jobId ?? null;
  const warnings = [];
  const requestedModules = REQUIRED_MODULES_BY_DEPTH[depth];

  const market = await collectMarketData({ instrument, options, warnings });
  const evidence =
    options.evidence ?? (await collectEvidence({ instrument, depth, options, warnings }));

  const envelope = buildEvidenceEnvelope({
    instrument,
    depth,
    quote: market.quote,
    crossQuotes: market.crossQuotes,
    candles: market.candles,
    indicators: market.indicators,
    chart: market.chart,
    structure: market.structure,
    evidence,
    quality: {
      dataWarnings: warnings,
      coverage: coverageSummary(buildCoverage({ now })),
      quoteFreshness: market.quote?.freshness ?? null
    },
    generatedAt: now().toISOString()
  });

  const agentRuns = {};
  const onAgentRun = (agent, run) => {
    agentRuns[agent] = run;
    options.onAgentRun?.(agent, run);
  };

  const parallel = parallelAgentsForDepth(depth);
  await Promise.all(
    parallel.map((agent) =>
      executeAgent({
        agent,
        envelope,
        context: {},
        provider,
        configOverrides: options.configOverrides,
        jobId,
        instrumentId: instrument.id,
        now,
        onAgentRun
      })
    )
  );

  const riskRun = await executeAgent({
    agent: "risk",
    envelope,
    context: {
      specialistOutputs: Object.entries(agentRuns).map(([agent, run]) => ({
        agent,
        status: run.status,
        error: run.error,
        output: run.output
      }))
    },
    provider,
    configOverrides: options.configOverrides,
    jobId,
    instrumentId: instrument.id,
    now,
    onAgentRun
  });

  const candleCount = market.candles?.candles?.length ?? 0;
  const gate = safeEvaluatePublicationGate({
    now: now().toISOString(),
    depth,
    requestedModules,
    instrument,
    quote: market.quote,
    crossQuotes: market.crossQuotes,
    candles: { count: candleCount, interval: market.candles?.interval ?? (options.interval ?? "1day") },
    agents: Object.entries(agentRuns).map(([agent, run]) => ({
      agent,
      status: run.status,
      outputValid: run.status === "COMPLETED",
      evidenceCount: envelope.evidence.items.length
    })),
    dataQuality: {
      criticalFlags: [],
      missingCandles: market.candles?.droppedRows ?? 0
    },
    newsCoverage: { articles: envelope.evidence?.counts?.returned ?? 0, lookbackDays: options.newsLookbackDays ?? 7 },
    riskWarnings: riskWarningsOf(riskRun)
  });

  const coordinatorRun = await executeAgent({
    agent: "coordinator",
    envelope,
    context: {
      specialistOutputs: Object.entries(agentRuns).map(([agent, run]) => ({
        agent,
        status: run.status,
        error: run.error,
        output: run.output
      })),
      gate
    },
    provider,
    configOverrides: options.configOverrides,
    jobId,
    instrumentId: instrument.id,
    now,
    onAgentRun
  });

  const createdAt = now().toISOString();
  const report = buildResearchReport({
    instrument,
    depth,
    jobId,
    modules: requestedModules,
    agentRuns,
    gate,
    envelope,
    coordinatorOutput: coordinatorRun.output,
    quote: market.quote,
    createdAt
  });

  const versions = {
    orchestrator: ORCHESTRATOR_VERSION,
    envelope: ENVELOPE_VERSION,
    promptEnvelope: PROMPT_ENVELOPE_VERSION,
    indicators: INDICATOR_ENGINE_VERSION,
    patterns: PATTERN_ENGINE_VERSION,
    structure: STRUCTURE_ENGINE_VERSION,
    gateRules: GATE_RULES_VERSION,
    reportBuilder: REPORT_BUILDER_VERSION,
    reproducibility: REPRODUCIBILITY_VERSION
  };

  const runId = jobId ?? report.jobId;
  const runConfig = buildRunConfig({
    runId,
    jobId,
    instrument,
    depth,
    requestedModules,
    market,
    envelope,
    gate,
    agentRuns,
    report,
    versions,
    options,
    analysisTimestamp: createdAt
  });
  const dataSnapshot = buildDataSnapshot({ market, envelope });

  const allCompleted = Object.values(agentRuns).every((run) => run.status === "COMPLETED");
  const anyCompleted = Object.values(agentRuns).some((run) => run.status === "COMPLETED");

  return {
    orchestratorVersion: ORCHESTRATOR_VERSION,
    instrument,
    instrumentId: instrument.id,
    depth,
    requestedModules,
    ok: allCompleted,
    status: allCompleted ? "COMPLETED" : anyCompleted ? "PARTIAL" : "FAILED",
    quote: market.quote,
    crossQuotes: market.crossQuotes,
    candles: market.candles
      ? {
          interval: market.candles.interval,
          count: candleCount,
          source: market.candles.source,
          coverage: market.candles.coverage,
          droppedRows: market.candles.droppedRows
        }
      : null,
    indicators: market.indicators,
    chart: market.chart,
    structure: market.structure,
    evidence: envelope.evidence,
    // Raw evidence items (schema-validated) travel separately so storage can
    // persist them with their fingerprints; the envelope copy is for prompts
    // and the UI and is deliberately trimmed.
    evidenceForStorage: evidence,
    agentRuns,
    gate,
    report,
    dataWarnings: warnings,
    runId,
    runConfig,
    dataSnapshot,
    reproducibility: {
      version: REPRODUCIBILITY_VERSION,
      runId,
      reportId: report.reportId,
      replayable: true,
      note: "Replay reads the stored report, evidence and data snapshot. It does not fetch a new price series."
    },
    versions,
    generatedAt: createdAt
  };
}
