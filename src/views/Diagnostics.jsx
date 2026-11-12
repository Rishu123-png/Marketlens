import { useCallback, useEffect, useState } from "react";
import { api, formatTime } from "../lib/api.js";

function statusChip(ok, labelTrue = "configured", labelFalse = "missing") {
  return <span className={ok ? "chip ok" : "chip bad"}>{ok ? labelTrue : labelFalse}</span>;
}

function count(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-IN") : "—";
}

/**
 * Data & AI diagnostics. Two separate panels on purpose: Groq credential/AI
 * health is not market-data health. The API returns only environment-variable
 * names, modes, counts and timings — never credential values.
 */
export default function Diagnostics() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [checkedAt, setCheckedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api("/api/diagnostics");
      setData(payload);
      setError(null);
      setCheckedAt(new Date().toISOString());
    } catch (cause) {
      setError(cause.message || "Diagnostics unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const ai = data?.ai;
  const market = data?.market;
  const credentials = ai?.credentials;
  const coverage = market?.instrumentCoverage;
  const runs = ai?.recentRuns || [];
  const requests = market?.recentRequests?.entries || [];

  return (
    <section className="lab diagnostics">
      <header className="lab-heading">
        <div>
          <span className="eyebrow">INTERNAL · DATA &amp; AI DIAGNOSTICS</span>
          <h1>
            Two independent systems, <span>never one green light.</span>
          </h1>
          <p>
            Groq credentials and executions are measured separately from market-data providers and requests. AI
            connectivity does not imply quote or candle coverage, and a market-data success does not imply AI readiness.
          </p>
        </div>
        <div className="heading-side">
          <button type="button" className="mode" onClick={load} disabled={loading}>
            {loading ? "Checking…" : "Refresh"}
          </button>
          <span className="chip muted">{checkedAt ? `AS OF ${formatTime(checkedAt)}` : "NOT CHECKED"}</span>
        </div>
      </header>

      {error && (
        <div className="notice error" role="alert">
          <strong>Diagnostics unavailable</strong>
          <p>{error}</p>
        </div>
      )}

      <div className="diagnostics-grid">
        <article className="panel diagnostics-panel ai-panel">
          <div className="panel-head">
            <div>
              <span className="section-kicker">PANEL A · GROQ AI</span>
              <h2>Credential routing &amp; agent execution</h2>
            </div>
            <span className={`chip ${credentials?.strictMode ? "bad" : "muted"}`}>
              {credentials?.strictMode ? "STRICT KEYS" : "SHARED FALLBACK ALLOWED"}
            </span>
          </div>

          <div className="diag-summary">
            <div>
              <span>DEDICATED KEYS</span>
              <strong>
                {count(credentials?.dedicatedConfigured)}/{count(credentials?.agentsConfigured)}
              </strong>
            </div>
            <div>
              <span>SHARED FALLBACK</span>
              <strong>{credentials?.sharedFallback?.configured ? "CONFIGURED" : "MISSING"}</strong>
              <small>{credentials?.sharedFallback?.envName || "GROQ_API_KEY"}</small>
            </div>
            <div>
              <span>AI REQUESTS</span>
              <strong>{count(ai?.usage?.requests)}</strong>
            </div>
            <div>
              <span>TOKENS</span>
              <strong>{count(ai?.usage?.totalTokens)}</strong>
            </div>
          </div>

          <table className="diag-table">
            <thead>
              <tr>
                <th>AGENT</th>
                <th>CREDENTIAL</th>
                <th>MODE</th>
                <th>MODEL</th>
                <th>TOKENS</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(ai?.agents || {}).map((agent) => (
                <tr key={agent.agent}>
                  <td>{agent.agent}</td>
                  <td>
                    <code>{agent.credential?.envName}</code>
                    <div>{statusChip(agent.credential?.configured)}</div>
                  </td>
                  <td>
                    <span className={`chip ${agent.credential?.mode === "dedicated" ? "ok" : agent.credential?.mode === "shared" ? "warn" : "bad"}`}>
                      {agent.credential?.mode || "none"}
                    </span>
                  </td>
                  <td>{agent.model || "—"}</td>
                  <td>{count(agent.usage?.totalTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="sub-heading">Recent agent runs</h3>
          {!runs.length && <div className="chart-placeholder empty compact">No agent runs recorded in this instance.</div>}
          <ul className="diag-run-list">
            {runs.map((run, index) => (
              <li key={`${run.at}-${run.agent}-${index}`}>
                <div className="diag-run-head">
                  <strong>{run.agent}</strong>
                  <span className={`chip ${run.status === "COMPLETED" ? "ok" : run.status === "FAILED" ? "bad" : "muted"}`}>
                    {run.status}
                  </span>
                  <span>{run.model || "—"}</span>
                  <span>{run.credentialEnvName || "no credential"} · {run.credentialMode}</span>
                  <span>{formatTime(run.at)}</span>
                </div>
                <div className="diag-run-metrics">
                  <span>HTTP {run.httpStatus ?? "—"}</span>
                  <span>{count(run.totalTokens)} tok</span>
                  <span>{count(run.durationMs)} ms</span>
                  <span>{count(run.requestCount)} request(s)</span>
                  <span>{count(run.retries)} retry</span>
                  {run.rateLimit && (
                    <span>
                      rate: {run.rateLimit.remainingRequests ?? "—"} req / {run.rateLimit.remainingTokens ?? "—"} tok
                    </span>
                  )}
                  {run.modelFallback && <span>fallback {run.modelFallback.from} → {run.modelFallback.to}</span>}
                </div>
                {run.failureReason && <p className="diag-error">{run.failureReason}</p>}
              </li>
            ))}
          </ul>
          <p className="muted-note">
            Credential values and Authorization headers are never returned. Separate keys do not multiply Groq
            organisation/project rate limits.
          </p>
        </article>

        <article className="panel diagnostics-panel market-panel">
          <div className="panel-head">
            <div>
              <span className="section-kicker">PANEL B · MARKET DATA</span>
              <h2>Provider health, coverage &amp; requests</h2>
            </div>
            <span className="chip muted">{market?.freshness?.classification || "unknown"} freshness</span>
          </div>

          <div className="diag-summary">
            <div>
              <span>CATALOGUED</span>
              <strong>{count(coverage?.catalogued)}</strong>
            </div>
            <div>
              <span>QUOTE ENABLED</span>
              <strong>{count(coverage?.quoteEnabled)}</strong>
            </div>
            <div>
              <span>VERIFIED LATEST</span>
              <strong>{count(coverage?.verifiedLatestQuote)}</strong>
            </div>
            <div>
              <span>CANDLE ENABLED</span>
              <strong>{count(coverage?.candleEnabled)}</strong>
            </div>
            <div>
              <span>REAL-TIME</span>
              <strong>{count(coverage?.realtime)}</strong>
            </div>
          </div>

          <p className="muted-note">
            Last successful quote: {formatTime(market?.observations?.quotes?.lastSuccessAt)} · Last successful candle
            batch: {formatTime(market?.observations?.candles?.lastSuccessAt)} · Request attempts:{" "}
            {count(market?.requestStates?.requestAttempted)} · Succeeded: {count(market?.requestStates?.requestSucceeded)} ·
            Cache hits: {count(market?.requestStates?.cacheHits)}
          </p>

          <table className="diag-table">
            <thead>
              <tr>
                <th>PROVIDER</th>
                <th>CONFIGURED</th>
                <th>VERIFICATION</th>
                <th>CAPABILITIES</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(market?.providers || {}).map(([id, provider]) => (
                <tr key={id}>
                  <td>{provider.label || id}</td>
                  <td>{statusChip(provider.configured)}</td>
                  <td>{provider.verification}</td>
                  <td>
                    {Object.entries(provider.capabilities || {})
                      .map(([capability, enabled]) => `${capability}:${enabled === true ? "yes" : enabled === false ? "no" : enabled}`)
                      .join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="sub-heading">Mapping checks</h3>
          <div className="diag-mapping">
            {Object.entries(market?.mappingChecks || {}).map(([symbol, info]) => (
              <div key={symbol}>
                <strong>{symbol}</strong>
                <span>{info.exchange} · {info.currency}</span>
                <ul>
                  {Object.entries(info.providers || {}).map(([provider, mapping]) => (
                    <li key={provider}>
                      {provider}: <code>{mapping.ticker || "unmapped"}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <h3 className="sub-heading">Recent market-data requests</h3>
          {!requests.length && (
            <div className="chart-placeholder empty compact">
              No quote or candle requests recorded in this instance.
            </div>
          )}
          <div className="diag-request-table">
            <table className="diag-table">
              <thead>
                <tr>
                  <th>TIME</th>
                  <th>KIND</th>
                  <th>INSTRUMENT</th>
                  <th>TF</th>
                  <th>PROVIDER</th>
                  <th>CACHE</th>
                  <th>HTTP</th>
                  <th>CANDLES</th>
                  <th>MS</th>
                  <th>ERROR</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((entry, index) => (
                  <tr key={`${entry.at}-${index}`}>
                    <td>{formatTime(entry.at)}</td>
                    <td>{entry.kind}</td>
                    <td>
                      {entry.symbol || entry.instrumentId}
                      <small>{entry.exchange || ""}</small>
                    </td>
                    <td>{entry.interval || "—"}</td>
                    <td>{entry.provider || "—"}</td>
                    <td>{entry.cacheHit ? "hit" : entry.attempted ? "miss" : "not sent"}</td>
                    <td>{entry.httpStatus ?? "—"}</td>
                    <td>{entry.returnedCount}{entry.droppedCount ? ` (${entry.droppedCount} dropped)` : ""}</td>
                    <td>{count(entry.durationMs)}</td>
                    <td title={entry.error || ""}>{entry.error ? entry.error.slice(0, 60) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted-note">
            Request telemetry is per serverless instance and resets on cold start. Configured is not verified; verified is
            not real-time.
          </p>
        </article>
      </div>

      <div className="diag-separation-banner">
        <strong>AI ≠ MARKET DATA</strong>
        <span>
          Groq credential status cannot prove that quotes or candles load. Market-data success cannot prove that any AI
          agent will run. Each panel has its own success, failure and freshness signals.
        </span>
      </div>
    </section>
  );
}
