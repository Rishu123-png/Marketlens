/**
 * Deterministic publication gate.
 *
 * This module decides PASS / PASS_WITH_WARNINGS / BLOCKED from structural facts
 * only. It deliberately imports nothing from `server/ai`: model output can add
 * warnings, but it can never satisfy a data requirement, clear a blocking
 * finding, or change the verdict.
 *
 * Fail-closed: if the gate itself produces a malformed result, the job is
 * treated as BLOCKED rather than published.
 */

import { GATE_RULES_VERSION, gateResultSchema } from "../../shared/schemas/gate.js";
import {
  REQUIRED_MODULES_BY_DEPTH,
  RESEARCH_DEPTHS,
  RESEARCH_MODULES
} from "../../shared/schemas/research.js";

export const GATE_THRESHOLDS = Object.freeze({
  /** Retrieval age at which a quote is still considered current. */
  retrievalFreshMs: 5 * 60 * 1000,
  /** Retrieval age beyond which a quote may not be published at all. */
  retrievalWarnMs: 30 * 60 * 1000,
  /** Provider timestamps older than this are called out (market may be closed). */
  providerTimestampWarnMs: 24 * 60 * 60 * 1000,
  /** Provider timestamps older than this are treated as stale data. */
  providerTimestampBlockMs: 7 * 24 * 60 * 60 * 1000,
  /** Relative disagreement between two providers that blocks publication. */
  priceDivergenceRatio: 0.005,
  /** Below these counts an analytical module cannot run at all. */
  minCandlesHard: Object.freeze({ technical: 35, chart: 10 }),
  /** Below these counts some indicators are unavailable (warn, not block). */
  minCandlesPreferred: Object.freeze({ technical: 200, chart: 60 }),
  /** News coverage below this is publishable but flagged. */
  newsCoverageWarn: 3,
  /** Sentiment below this sample size is publishable but flagged. */
  sentimentMinArticlesWarn: 5
});

const MODULE_AGENT = Object.freeze({
  technical: "technical",
  chart: "chart",
  news: "news",
  sentiment: "sentiment",
  risk: "risk"
});

function ageMs(timestamp, nowMs) {
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, nowMs - parsed);
}

function ratio(a, b) {
  const largest = Math.max(Math.abs(a), Math.abs(b));
  if (largest === 0) return 0;
  return Math.abs(a - b) / largest;
}

/**
 * @param {object} facts Ground truth assembled by deterministic code.
 * @param {string} [facts.now] ISO timestamp used for freshness maths.
 * @param {string} facts.depth Requested research depth.
 * @param {string[]} facts.requestedModules Modules the caller asked for.
 * @param {{id:string,currency?:string,exchange?:string}|null} [facts.instrument]
 * @param {object|null} [facts.quote] Normalized quote (price, retrievedAt, provider, …).
 * @param {Array<{provider:string,price:number,currency?:string}>} [facts.crossQuotes]
 * @param {{count:number,interval?:string}|null} [facts.candles]
 * @param {Array<{agent:string,status:string,outputValid?:boolean,evidenceCount?:number}>} [facts.agents]
 * @param {{criticalFlags?:string[],missingCandles?:number}} [facts.dataQuality]
 * @param {{articles?:number,lookbackDays?:number}} [facts.newsCoverage]
 * @param {string[]} [facts.riskWarnings] Advisory text from the risk agent; never affects the verdict.
 */
export function evaluatePublicationGate(facts = {}) {
  const nowMs = Date.parse(facts.now || new Date().toISOString());
  const checks = [];

  const add = (rule, status, detail) => checks.push({ rule, status, detail: detail || "" });

  const requestedModules = Array.isArray(facts.requestedModules) ? [...facts.requestedModules] : [];
  const depthKnown = RESEARCH_DEPTHS.includes(facts.depth);
  const requiredModules = depthKnown ? REQUIRED_MODULES_BY_DEPTH[facts.depth] : [];

  add(
    "depth.supported",
    depthKnown ? "pass" : "block",
    depthKnown ? `depth=${facts.depth}` : `unknown depth: ${String(facts.depth)}`
  );

  const unknownModules = requestedModules.filter((module) => !RESEARCH_MODULES.includes(module));
  add(
    "modules.recognized",
    unknownModules.length ? "block" : "pass",
    unknownModules.length ? `unknown modules: ${unknownModules.join(", ")}` : `${requestedModules.length} module(s)`
  );

  const missingModules = requiredModules.filter((module) => !requestedModules.includes(module));
  add(
    "depth.missing-module",
    missingModules.length ? "block" : "pass",
    missingModules.length
      ? `${facts.depth} depth requires: ${missingModules.join(", ")}`
      : "all mandatory modules requested"
  );

  // ---------------------------------------------------------------- identity
  const instrument = facts.instrument;
  add(
    "identity.resolved",
    instrument?.id ? "pass" : "block",
    instrument?.id ? `instrument=${instrument.id}` : "instrument identity is unresolved"
  );

  const quote = facts.quote;
  const sameInstrument = Boolean(instrument?.id && quote?.instrumentId === instrument.id);
  add(
    "identity.quote-instrument",
    quote ? (sameInstrument ? "pass" : "block") : "skip",
    quote
      ? sameInstrument
        ? "quote belongs to the requested instrument"
        : `quote for ${quote.instrumentId || "unknown"} cannot be used for ${instrument?.id || "unknown"}`
      : "no quote supplied"
  );

  const currencyMismatch = Boolean(
    quote?.currency && instrument?.currency && quote.currency !== instrument.currency
  );
  add(
    "identity.currency",
    !quote
      ? "skip"
      : currencyMismatch
        ? "block"
        : quote.currency
          ? "pass"
          : "warn",
    !quote
      ? "no quote supplied"
      : currencyMismatch
        ? `${quote.currency} quote cannot price a ${instrument?.currency} instrument`
        : quote.currency
          ? `currency=${quote.currency}`
          : "provider did not report a currency"
  );

  // ------------------------------------------------------------------- quote
  const priceUsable = Boolean(quote) && quote.quoteVerified === true && Number.isFinite(quote.price);
  add(
    "quote.present",
    priceUsable ? "pass" : "block",
    priceUsable
      ? `verified price from ${quote.provider || "provider"}`
      : quote
        ? "quote is not provider-verified"
        : "no verified quote is available"
  );

  const retrievalAge = ageMs(quote?.retrievedAt, nowMs);
  let freshness = "skip";
  let freshnessDetail = "no quote supplied";
  if (quote) {
    if (retrievalAge === null) {
      freshness = "warn";
      freshnessDetail = "quote has no retrieval timestamp; freshness cannot be proven";
    } else if (retrievalAge <= GATE_THRESHOLDS.retrievalFreshMs) {
      freshness = "pass";
      freshnessDetail = `retrieved ${Math.round(retrievalAge / 1000)}s ago`;
    } else if (retrievalAge <= GATE_THRESHOLDS.retrievalWarnMs) {
      freshness = "warn";
      freshnessDetail = `retrieved ${Math.round(retrievalAge / 60000)}m ago; data may be delayed`;
    } else {
      freshness = "block";
      freshnessDetail = `retrieved ${Math.round(retrievalAge / 60000)}m ago; too old to publish`;
    }
  }
  add("quote.freshness", freshness, freshnessDetail);

  const providerAge = ageMs(quote?.providerTimestamp, nowMs);
  let providerStatus = "skip";
  let providerDetail = "no provider timestamp";
  if (quote?.providerTimestamp) {
    if (providerAge <= GATE_THRESHOLDS.providerTimestampWarnMs) {
      providerStatus = "pass";
      providerDetail = "provider timestamp within 24h";
    } else if (providerAge <= GATE_THRESHOLDS.providerTimestampBlockMs) {
      providerStatus = "warn";
      providerDetail = `provider timestamp is ${Math.round(providerAge / 3600000)}h old (market may be closed)`;
    } else {
      providerStatus = "block";
      providerDetail = `provider timestamp is ${Math.round(providerAge / 86400000)}d old`;
    }
  } else if (quote) {
    providerStatus = "warn";
    providerDetail = "provider timestamp missing";
  }
  add("quote.provider-timestamp", providerStatus, providerDetail);

  const crossQuotes = Array.isArray(facts.crossQuotes) ? facts.crossQuotes.filter((entry) => Number.isFinite(entry?.price)) : [];
  let crossStatus = "warn";
  let crossDetail = "single source; no independent price to compare against";
  if (crossQuotes.length >= 2) {
    const prices = crossQuotes.map((entry) => entry.price);
    const spread = ratio(Math.max(...prices), Math.min(...prices));
    if (spread > GATE_THRESHOLDS.priceDivergenceRatio) {
      crossStatus = "block";
      crossDetail = `providers disagree by ${(spread * 100).toFixed(2)}% (limit ${(GATE_THRESHOLDS.priceDivergenceRatio * 100).toFixed(2)}%)`;
    } else {
      crossStatus = "pass";
      crossDetail = `providers agree within ${(spread * 100).toFixed(2)}%`;
    }
  }
  add("quote.cross-check", crossStatus, crossDetail);

  // ----------------------------------------------------------------- candles
  const candleCount = Number.isInteger(facts.candles?.count) ? facts.candles.count : 0;
  const analyticalModules = requiredModules.filter((module) => module === "technical" || module === "chart");

  for (const module of analyticalModules) {
    const hard = GATE_THRESHOLDS.minCandlesHard[module];
    const preferred = GATE_THRESHOLDS.minCandlesPreferred[module];

    add(
      `candles.${module}.present`,
      candleCount >= hard ? "pass" : "block",
      candleCount >= hard
        ? `${candleCount} candles`
        : `${candleCount} candles; ${module} needs at least ${hard}`
    );

    add(
      `candles.${module}.depth`,
      candleCount >= preferred ? "pass" : "warn",
      candleCount >= preferred
        ? `${candleCount} candles cover the preferred window`
        : `${candleCount} candles; some long-period indicators will be unavailable (preferred ${preferred})`
    );
  }

  if (Number.isInteger(facts.dataQuality?.missingCandles) && facts.dataQuality.missingCandles > 0) {
    add("candles.gaps", "warn", `${facts.dataQuality.missingCandles} missing candle value(s) in the series`);
  }

  // ------------------------------------------------------------ data quality
  const criticalFlags = Array.isArray(facts.dataQuality?.criticalFlags)
    ? facts.dataQuality.criticalFlags.filter(Boolean)
    : [];
  add(
    "data-quality.critical",
    criticalFlags.length ? "block" : "pass",
    criticalFlags.length ? `critical data issue(s): ${criticalFlags.join(", ")}` : "no critical data flags"
  );

  // ------------------------------------------------------------------ agents
  const agentRuns = new Map(
    (Array.isArray(facts.agents) ? facts.agents : [])
      .filter((run) => run && run.agent)
      .map((run) => [run.agent, run])
  );

  const requiredAgents = requiredModules.map((module) => MODULE_AGENT[module]).filter(Boolean);

  for (const agent of requiredAgents) {
    const run = agentRuns.get(agent);

    if (!run) {
      add(`agent.${agent}.required`, "block", `${agent} is required for ${facts.depth} research but did not run`);
      continue;
    }

    add(
      `agent.${agent}.status`,
      run.status === "COMPLETED" ? "pass" : "block",
      `${agent} finished with status ${run.status}`
    );

    if (run.status === "COMPLETED" && run.outputValid === false) {
      add(`agent.${agent}.output`, "block", `${agent} returned output that failed schema validation`);
    }

    if (run.status === "COMPLETED" && (agent === "news" || agent === "sentiment")) {
      const evidenceCount = Number.isInteger(run.evidenceCount) ? run.evidenceCount : 0;
      add(
        `agent.${agent}.evidence`,
        evidenceCount > 0 ? "pass" : "block",
        evidenceCount > 0 ? `${evidenceCount} evidence item(s)` : `${agent} reported findings without evidence`
      );
    }
  }

  for (const [agent, run] of agentRuns) {
    if (requiredAgents.includes(agent)) continue;
    if (run.status === "FAILED" || run.status === "SKIPPED" || run.status === "BLOCKED") {
      add(`agent.${agent}.optional`, "warn", `optional ${agent} agent is ${run.status.toLowerCase()}`);
    }
  }

  // -------------------------------------------------------- news & sentiment
  const newsArticles = Number.isInteger(facts.newsCoverage?.articles) ? facts.newsCoverage.articles : 0;
  if (requestedModules.includes("news")) {
    add(
      "news.coverage",
      newsArticles >= GATE_THRESHOLDS.newsCoverageWarn ? "pass" : "warn",
      `${newsArticles} article(s) within the lookback window`
    );
  }

  if (requestedModules.includes("sentiment")) {
    add(
      "sentiment.sample",
      newsArticles >= GATE_THRESHOLDS.sentimentMinArticlesWarn ? "pass" : "warn",
      `${newsArticles} article(s) for sentiment; small samples are unreliable`
    );
  }

  // Advisory risk-agent text: appended as warnings only. It cannot block a
  // failed data check and cannot clear one either.
  const riskWarnings = Array.isArray(facts.riskWarnings) ? facts.riskWarnings.filter(Boolean) : [];
  for (const [index, warning] of riskWarnings.entries()) {
    add(`risk.advisory.${index + 1}`, "warn", String(warning).slice(0, 500));
  }

  const blocking = checks
    .filter((check) => check.status === "block")
    .map((check) => ({ rule: check.rule, message: check.detail || check.rule }));
  const warnings = checks
    .filter((check) => check.status === "warn")
    .map((check) => ({ rule: check.rule, message: check.detail || check.rule }));

  const verdict = blocking.length ? "BLOCKED" : warnings.length ? "PASS_WITH_WARNINGS" : "PASS";

  const result = {
    verdict,
    rulesVersion: GATE_RULES_VERSION,
    evaluatedAt: new Date(nowMs).toISOString(),
    checks,
    blocking,
    warnings
  };

  const parsed = gateResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new GateInternalError("Gate produced an invalid result", parsed.error);
  }

  return parsed.data;
}

export class GateInternalError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "GateInternalError";
    this.code = "GATE_INTERNAL_ERROR";
    this.statusCode = 500;
    this.details = cause?.issues?.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    }));
  }
}

/**
 * Fail-closed wrapper. Any unexpected condition becomes a BLOCKED verdict with a
 * diagnostic rule instead of an unpublished or partially-published report.
 */
export function safeEvaluatePublicationGate(facts = {}) {
  try {
    return evaluatePublicationGate(facts);
  } catch (error) {
    const evaluatedAt = new Date().toISOString();
    return {
      verdict: "BLOCKED",
      rulesVersion: GATE_RULES_VERSION,
      evaluatedAt,
      checks: [
        {
          rule: "gate.internal-error",
          status: "block",
          detail: error instanceof Error ? error.message : "gate evaluation failed"
        }
      ],
      blocking: [{ rule: "gate.internal-error", message: "Publication gate could not be evaluated." }],
      warnings: []
    };
  }
}
