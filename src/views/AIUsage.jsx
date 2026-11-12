import { useCallback, useEffect, useState } from "react";
import { api, formatTime } from "../lib/api.js";

function count(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-IN") : "—";
}

/**
 * AI Usage workspace. Deliberately says nothing about market-data coverage.
 * Only environment-variable names, models, token counts and outcomes appear.
 */
export default function AIUsage() {
  const [ai, setAi] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api("/api/diagnostics");
      setAi(payload.ai);
      setError(null);
    } catch (cause) {
      setError(cause.message || "AI usage unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const credentials = ai?.credentials;
  const agents = Object.values(ai?.agents || {});
  const runs = ai?.recentRuns || [];

  return (
    <section className="lab ai-usage">
      <header className="lab-heading">
        <div>
          <span className="eyebrow">AI USAGE · SEPARATE FROM MARKET DATA</span>
          <h1>
            Model routing, <span>not price coverage.</span>
          </h1>
          <p>
            Six dedicated Groq agents can be healthy while every provider quote is unavailable — and vice versa. This
            workspace reports credential presence by environment-variable name, model routing, token usage and run
            outcomes. Values and headers are never included.
          </p>
        </div>
        <div className="heading-side">
          <button type="button" className="mode" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <span className="chip muted">{ai?.liveModelVerification || "NOT VERIFIED"}</span>
        </div>
      </header>

      {error && (
        <div className="notice error" role="alert">
          <strong>AI usage unavailable</strong>
          <p>{error}</p>
        </div>
      )}

      <div className="diag-summary">
        <div>
          <span>DEDICATED KEYS</span>
          <strong>{count(credentials?.dedicatedConfigured)}/{count(credentials?.agentsConfigured)}</strong>
        </div>
        <div>
          <span>SHARED FALLBACK</span>
          <strong>{credentials?.sharedFallback?.configured ? "CONFIGURED" : "MISSING"}</strong>
        </div>
        <div>
          <span>REQUESTS</span>
          <strong>{count(ai?.usage?.requests)}</strong>
        </div>
        <div>
          <span>PROMPT TOKENS</span>
          <strong>{count(ai?.usage?.promptTokens)}</strong>
        </div>
        <div>
          <span>COMPLETION TOKENS</span>
          <strong>{count(ai?.usage?.completionTokens)}</strong>
        </div>
        <div>
          <span>TOTAL TOKENS</span>
          <strong>{count(ai?.usage?.totalTokens)}</strong>
        </div>
      </div>

      <article className="panel diagnostics-panel">
        <div className="panel-head">
          <div>
            <span className="section-kicker">AGENT ROUTING</span>
            <h2>Credential, mode, model and usage per agent</h2>
          </div>
          <span className={`chip ${credentials?.strictMode ? "bad" : "muted"}`}>
            {credentials?.strictMode ? "STRICT KEYS" : "SHARED FALLBACK ALLOWED"}
          </span>
        </div>
        <table className="diag-table">
          <thead>
            <tr>
              <th>AGENT</th>
              <th>ENV VAR (NAME ONLY)</th>
              <th>MODE</th>
              <th>MODEL</th>
              <th>REQUESTS</th>
              <th>TOKENS</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.agent}>
                <td>{agent.agent}</td>
                <td><code>{agent.credential?.envName || "—"}</code></td>
                <td>
                  <span className={`chip ${agent.credential?.mode === "dedicated" ? "ok" : agent.credential?.mode === "shared" ? "warn" : "bad"}`}>
                    {agent.credential?.mode || "none"}
                  </span>
                </td>
                <td>{agent.model || "—"}</td>
                <td>{count(agent.usage?.requests)}</td>
                <td>{count(agent.usage?.totalTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted-note">
          Separate keys do not multiply the Groq organisation/project rate limit. Credential values are never returned.
        </p>
      </article>

      <article className="panel diagnostics-panel">
        <div className="panel-head">
          <div>
            <span className="section-kicker">RECENT RUNS</span>
            <h2>Execution outcomes and tool usage</h2>
          </div>
          <span className="chip muted">{count(runs.length)} RUNS</span>
        </div>
        {!runs.length && <div className="chart-placeholder empty compact">No agent runs recorded in this instance.</div>}
        <ul className="diag-run-list">
          {runs.slice(0, 40).map((run, index) => (
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
                <span>{count(run.toolRounds)} tool round(s)</span>
                {run.modelFallback && <span>fallback {run.modelFallback.from} → {run.modelFallback.to}</span>}
              </div>
              {run.failureReason && <p className="diag-error">{run.failureReason}</p>}
            </li>
          ))}
        </ul>
      </article>

      <div className="diag-separation-banner">
        <strong>AI ≠ MARKET DATA</strong>
        <span>
          Groq token usage cannot prove that an NSE or BSE quote exists. Coverage, freshness and provider entitlement are
          reported only in the Market Data Coverage workspace.
        </span>
      </div>
    </section>
  );
}
