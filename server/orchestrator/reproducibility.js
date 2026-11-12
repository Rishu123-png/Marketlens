/**
 * Reproducibility metadata for a research run.
 *
 * The goal is to answer, months later: which instrument, which provider, which
 * data timestamps, which candle range, which models and which evidence produced
 * this report? Replay reads these stored objects; it never silently refreshes a
 * provider series and calls the result the same analysis.
 *
 * Nothing here stores credentials, request URLs or Authorization headers.
 */

import { createHash } from "node:crypto";
import { MAX_TOOL_CALLS_PER_RUN } from "../agents/tools.js";
import { toolAgentIds, toolCallingEnabled } from "../ai/toolPolicy.js";

export const REPRODUCIBILITY_VERSION = "1.0.0";

function hash(value, length = 16) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function iso(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function instrumentIdentity(instrument) {
  if (!instrument) return null;
  return {
    id: instrument.id,
    symbol: instrument.symbol,
    name: instrument.name,
    exchange: instrument.exchange,
    country: instrument.country,
    currency: instrument.currency,
    assetType: instrument.assetType,
    sector: instrument.sector,
    underlyingId: instrument.underlyingId ?? null,
    contractTemplate: instrument.contractTemplate ?? null,
    expiry: instrument.expiry ?? null,
    strike: instrument.strike ?? null,
    optionType: instrument.optionType ?? null,
    lotSize: instrument.lotSize ?? null,
    lotSizeStatus: instrument.lotSizeStatus ?? null
  };
}

function candleRange(candles) {
  const series = candles?.candles ?? [];
  if (!series.length) return null;
  return {
    from: series[0].time ?? null,
    to: series.at(-1).time ?? null,
    count: series.length,
    interval: candles.interval ?? null
  };
}

/**
 * @param {object} input
 * @param {string} input.runId
 * @param {string|null} input.jobId
 * @param {object} input.instrument
 * @param {string} input.depth
 * @param {string[]} input.requestedModules
 * @param {object} input.market
 * @param {object} input.envelope
 * @param {object} input.gate
 * @param {object} input.agentRuns
 * @param {object} input.report
 * @param {object} input.versions
 * @param {object} [input.options]
 * @param {string} input.analysisTimestamp
 */
export function buildRunConfig({
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
  options = {},
  analysisTimestamp
}) {
  const agents = Object.fromEntries(
    Object.entries(agentRuns || {}).map(([agent, run]) => [
      agent,
      {
        status: run.status,
        provider: run.provider ?? null,
        model: run.model ?? null,
        promptVersion: run.promptVersion ?? null,
        schemaVersion: run.schemaVersion ?? null,
        attempts: run.attempts ?? 0,
        retries: run.retries ?? 0,
        toolRounds: run.toolRounds ?? 0,
        toolsDisabled: run.toolsDisabled === true,
        modelFallback: run.modelFallback ?? null
      }
    ])
  );

  return {
    version: REPRODUCIBILITY_VERSION,
    runId,
    jobId: jobId ?? null,
    reportId: report?.reportId ?? null,
    analysisTimestamp,
    depth,
    requestedModules,
    instrument: instrumentIdentity(instrument),
    dataPolicy: {
      primaryMarketProvider: process.env.PRIMARY_MARKET_PROVIDER || "fmp",
      secondaryMarketProvider: process.env.SECONDARY_MARKET_PROVIDER || null,
      interval: market?.candles?.interval ?? options.interval ?? "1day",
      candleLimit: market?.candles?.requestedLimit ?? options.candleLimit ?? null,
      newsLookbackDays: options.newsLookbackDays ?? 7,
      evidenceLimit: envelope?.evidence?.items?.length ?? 0,
      cacheRequested: options.cache ?? true
    },
    sourceProviders: {
      quote: market?.quote?.provider ?? null,
      crossQuotes: (market?.crossQuotes || []).map((entry) => entry.provider),
      candles: market?.candles?.provider ?? null,
      candleSourceLabel: market?.candles?.source ?? null,
      evidenceSources: (envelope?.evidence?.sources || []).map((source) => source.id)
    },
    dataTimestamps: {
      quoteProvider: iso(market?.quote?.providerTimestamp),
      quoteRetrieved: iso(market?.quote?.retrievedAt),
      candlesRetrieved: iso(market?.candles?.retrievedAt),
      evidenceRetrieved: iso(envelope?.generatedAt)
    },
    candleRange: candleRange(market?.candles),
    agentConfig: agents,
    toolPolicy: {
      enabled: toolCallingEnabled(),
      agents: toolAgentIds(),
      maxCallsPerAgentRun: MAX_TOOL_CALLS_PER_RUN
    },
    evidenceRefs: (envelope?.evidence?.items || []).map((item) => ({
      evidenceId: item.evidenceId,
      publisher: item.publisher ?? null,
      publishedAt: item.publishedAt ?? null,
      sourceType: item.sourceType ?? null
    })),
    gate: gate
      ? {
          verdict: gate.verdict,
          rulesVersion: gate.rulesVersion,
          blocking: (gate.blocking?.length ?? 0) > 0,
          warningCount: gate.warnings?.length ?? 0
        }
      : null,
    engineVersions: versions ?? null,
    finalReportId: report?.reportId ?? null
  };
}

/** Exact data supplied to the agents. Replay uses this, not a new fetch. */
export function buildDataSnapshot({ market, envelope }) {
  const series = market?.candles?.candles ?? [];
  return {
    version: REPRODUCIBILITY_VERSION,
    generatedAt: envelope?.generatedAt ?? null,
    instrumentId: envelope?.instrument?.instrumentId ?? null,
    quote: market?.quote ?? null,
    crossQuotes: market?.crossQuotes ?? [],
    candles: market?.candles
      ? {
          interval: market.candles.interval,
          source: market.candles.source,
          retrievedAt: market.candles.retrievedAt ?? null,
          coverage: market.candles.coverage ?? null,
          droppedRows: market.candles.droppedRows ?? 0,
          count: series.length,
          from: series[0]?.time ?? null,
          to: series.at(-1)?.time ?? null,
          // The envelope already carries the recent 30 candles agents saw; the
          // full series is stored so indicators can be recomputed exactly.
          candles: series
        }
      : null,
    indicators: market?.indicators ?? null,
    chart: market?.chart ?? null,
    structure: market?.structure ?? null,
    evidence: envelope?.evidence ?? null,
    quality: envelope?.quality ?? null,
    snapshotHash: hash(JSON.stringify({ quote: market?.quote ?? null, candles: series, evidence: envelope?.evidence ?? null }))
  };
}

/**
 * Reconstruct the persisted report payload from stored rows only.
 * No provider, AI or network call is made.
 */
export function buildReplayPayload({ job, result, agentRuns = {} }) {
  const report = result?.report ?? null;
  if (!report) {
    return {
      replayable: false,
      reason: "No stored report exists for this job; replay will not fetch new data."
    };
  }
  return {
    replayable: true,
    replayVersion: REPRODUCIBILITY_VERSION,
    replayed: true,
    source: "stored",
    jobId: job?.jobId ?? report.jobId,
    report,
    runConfig: result?.runConfig ?? null,
    dataSnapshot: result?.dataSnapshot ?? null,
    evidence: result?.evidence ?? null,
    agentRuns,
    gate: job?.gate ?? result?.gate ?? report.gate ?? null,
    versions: result?.versions ?? null,
    note:
      "This report is replayed from the stored report, evidence and data snapshot. No provider or model was called, and no newer price series was substituted."
  };
}
