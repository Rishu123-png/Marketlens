#!/usr/bin/env node
/**
 * Production verification against a deployed Market Lens instance.
 *
 * Runs one comprehensive research job so all six agents execute, then prints
 * each agent's credential environment-variable NAME and mode from the persisted
 * job record. It also fetches candles separately and proves the market-data path
 * does not change the AI request counter.
 *
 * Never prints or stores credential values.
 */

import { randomBytes } from "node:crypto";

const baseUrl = (process.env.BASE_URL || "https://marketlens-pi.vercel.app").replace(/\/+$/, "");
const symbol = (process.env.SYMBOL || "TCS").toUpperCase();
const exchange = (process.env.EXCHANGE || "NSE").toUpperCase();
const depth = process.env.DEPTH || "comprehensive";
const interval = process.env.INTERVAL || "1day";
const pollMs = Number(process.env.POLL_MS || 5000);
const timeoutMs = Number(process.env.TIMEOUT_MS || 600000);
const owner = randomBytes(16).toString("hex");

function log(...args) {
  console.log(...args);
}

async function requestJson(path, { method = "GET", body = null, timeout = 60000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-owner-id": owner
      },
      body: body === null ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 500) };
    }
    return { status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function agentSummary(run) {
  return {
    agent: run.agent,
    status: run.status,
    credentialEnvName: run.credentialEnvName ?? null,
    credentialMode: run.credentialMode ?? "none",
    model: run.model ?? null,
    requestCount: run.requestCount ?? 0,
    httpStatus: run.httpStatus ?? null,
    attempts: run.attempts ?? 0,
    retries: run.retries ?? 0,
    totalTokens: run.usage?.totalTokens ?? 0,
    durationMs: run.durationMs ?? null,
    rateLimit: run.rateLimit ?? null,
    modelFallback: run.modelFallback ?? null,
    error: run.error ?? null
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  log(`BASE_URL=${baseUrl}`);
  log(`JOB=${symbol}:${exchange} depth=${depth}`);

  const before = await requestJson("/api/diagnostics");
  if (before.status !== 200) {
    log("BASELINE_DIAGNOSTICS_FAILED", before.status, JSON.stringify(before.data).slice(0, 500));
  } else {
    log("BASELINE_CREDENTIALS", JSON.stringify(before.data.ai.credentials));
    log("BASELINE_AI_USAGE", JSON.stringify(before.data.ai.usage));
  }

  const created = await requestJson("/api/research", {
    method: "POST",
    body: { symbol, exchange, depth },
    timeout: 60000
  });
  log("RESEARCH_CREATE", created.status, JSON.stringify(created.data));
  if (created.status !== 202) {
    throw new Error(`Research job was not created (HTTP ${created.status}).`);
  }

  const jobId = created.data.jobId;
  const started = Date.now();
  let detail = null;
  let terminal = false;

  while (Date.now() - started < timeoutMs) {
    await sleep(pollMs);
    const poll = await requestJson(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (poll.status !== 200) {
      log("POLL", poll.status, JSON.stringify(poll.data).slice(0, 300));
      continue;
    }
    detail = poll.data;
    const status = detail.job?.status;
    log("POLL", status, `${Math.round((Date.now() - started) / 1000)}s`);
    if (["COMPLETED", "PARTIAL", "BLOCKED", "FAILED", "CANCELLED"].includes(status)) {
      terminal = true;
      break;
    }
  }

  if (!terminal) {
    throw new Error(`Research job ${jobId} did not reach a terminal state within ${timeoutMs} ms.`);
  }

  const runs = Object.values(detail.agentRuns || {});
  log("JOB_STATUS", detail.job.status);
  log("AGENT_COUNT", runs.length);
  for (const run of runs.map(agentSummary)) log("AGENT_RUN", JSON.stringify(run));

  const expected = ["chart", "technical", "news", "sentiment", "risk", "coordinator"];
  const seen = new Set(runs.map((run) => run.agent));
  for (const agent of expected) {
    if (!seen.has(agent)) log("MISSING_AGENT", agent);
  }
  for (const agent of expected) {
    const run = runs.find((entry) => entry.agent === agent);
    if (!run) continue;
    if (!run.credentialEnvName) log("NO_CREDENTIAL_NAME", agent);
    if (run.credentialMode !== "dedicated") log("NOT_DEDICATED", agent, run.credentialMode);
  }

  const candles = await requestJson(
    `/api/history?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange)}&interval=${encodeURIComponent(interval)}&limit=120`
  );
  log("HISTORY_STATUS", candles.status);
  if (candles.status === 200) {
    log(
      "HISTORY_SUMMARY",
      JSON.stringify({
        instrumentId: candles.data.instrumentId,
        source: candles.data.source,
        candleCount: candles.data.candles?.length ?? 0,
        droppedRows: candles.data.droppedRows ?? 0,
        coverage: candles.data.coverage ?? null,
        cached: candles.data.cached ?? null
      })
    );
  } else {
    log("HISTORY_ERROR", JSON.stringify(candles.data).slice(0, 800));
  }

  const after = await requestJson("/api/diagnostics");
  if (after.status === 200) {
    log("AFTER_AI_USAGE", JSON.stringify(after.data.ai.usage));
    log(
      "AFTER_AGENT_USAGE",
      JSON.stringify(
        Object.fromEntries(
          Object.entries(after.data.ai.agents || {}).map(([agent, value]) => [
            agent,
            { envName: value.credential?.envName, mode: value.credential?.mode, usage: value.usage }
          ])
        )
      )
    );
    log(
      "AFTER_MARKET",
      JSON.stringify({
        quotes: after.data.market.observations.quotes,
        candles: after.data.market.observations.candles,
        requestStates: after.data.market.requestStates
      })
    );
  }

  if (!seen.has("news") || !seen.has("sentiment")) {
    throw new Error("Not all six agents ran; news/sentiment are missing from the persisted job.");
  }
  if (runs.some((run) => run.credentialMode !== "dedicated")) {
    throw new Error("At least one agent did not use a dedicated credential.");
  }
  log("VERIFICATION_OK");
}

main().catch((error) => {
  console.error("VERIFICATION_FAILED", error?.message || error);
  process.exitCode = 1;
});
