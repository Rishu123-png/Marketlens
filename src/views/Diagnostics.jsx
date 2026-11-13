import Icon from "../components/terminal/Icon.jsx";
import TerminalPanel from "../components/terminal/TerminalPanel.jsx";
import DataStatus from "../components/terminal/DataStatus.jsx";
import EvidenceBadge from "../components/terminal/EvidenceBadge.jsx";
import EmptyState from "../components/terminal/EmptyState.jsx";
import MarketTable from "../components/terminal/MarketTable.jsx";
import { useApiResource } from "../lib/useApi.js";
import { formatTime } from "../lib/api.js";
import { compactNumber } from "../lib/marketVisuals.js";
import { credentialSelection } from "../lib/aiRouting.js";

export default function Diagnostics({ onNavigate }) {
  const { data, error, loading, reload } = useApiResource("/api/diagnostics", { intervalMs: 30_000 });
  const market = data?.market;
  const ai = data?.ai;
  const providers = Object.values(market?.registry?.providers || {});
  const observations = market?.observations;
  const requests = market?.recentRequests?.entries || [];
  const agents = Object.values(ai?.agents || {});

  const providerColumns = [
    { key: "id", label: "PROVIDER", value: (row) => row.label || row.id, render: (row) => <strong>{row.label || row.id}</strong> },
    { key: "mode", label: "STATUS", value: (row) => row.status || "active", render: (row) => <span className={`mode-pill ${row.status || "active"}`}>{row.status || "active"}</span> },
    { key: "configured", label: "KEY", value: (row) => row.configured, render: (row) => <DataStatus state={{ code: row.configured ? "delayed" : "unavailable", label: row.configured ? "CONFIGURED" : "MISSING" }} compact /> },
    { key: "health", label: "CIRCUIT", value: (row) => row.health?.circuit || "unknown", render: (row) => <span className="status-text">{row.health?.circuit || "unknown"}</span> },
    { key: "verification", label: "VERIFICATION", value: (row) => row.verification?.live ? "live observed" : row.verification?.declared ? "declared" : "unverified", render: (row) => <span className="status-text">{row.verification?.live ? "live observed" : row.verification?.declared ? "declared" : "unverified"}</span> },
    { key: "realtime", label: "REALTIME", value: (row) => Boolean(row.quote?.realtime), render: (row) => <span className={row.quote?.realtime ? "value-up" : "muted"}>{row.quote?.realtime ? "claimed" : "not claimed"}</span> },
    { key: "tier", label: "LICENSING", value: (row) => row.licensing?.display || "—", render: (row) => <span className="status-text diag-license">{row.licensing?.display || "—"}</span> }
  ];

  const requestColumns = [
    { key: "at", label: "TIME", value: (row) => row.at, render: (row) => <span className="muted">{formatTime(row.at)}</span> },
    { key: "kind", label: "KIND", value: (row) => row.kind },
    { key: "provider", label: "PROVIDER", value: (row) => row.provider || "—" },
    { key: "attempted", label: "ATTEMPT", value: (row) => row.attempted, render: (row) => row.attempted ? "yes" : "no" },
    { key: "httpStatus", label: "HTTP", align: "right", value: (row) => row.httpStatus ?? 0, render: (row) => row.httpStatus ?? "—" },
    { key: "returnedCount", label: "ROWS", align: "right", value: (row) => row.returnedCount ?? 0, render: (row) => row.returnedCount ?? "—" },
    { key: "durationMs", label: "MS", align: "right", value: (row) => row.durationMs ?? 0, render: (row) => row.durationMs ?? "—" }
  ];

  return (
    <section className="workspace diagnostics-workspace">
      <header className="workspace-head">
        <div>
          <span className="workspace-kicker">DIAGNOSTICS · SYSTEM HEALTH</span>
          <h1>Diagnostics</h1>
          <p>Provider health, request telemetry and AI routing. No credential value, URL or authorization header appears here.</p>
        </div>
        <div className="workspace-head-actions">
          <span className="head-date">{data ? `GENERATED ${formatTime(data.generatedAt)}` : "LOADING"}</span>
          <button type="button" className="t-btn secondary sm" onClick={reload} disabled={loading}><Icon name="refresh" size={13} className={loading ? "spin" : ""} /> Refresh</button>
        </div>
      </header>

      {error && <div className="inline-alert error" role="alert"><Icon name="warn" size={15} /><div><strong>Diagnostics unavailable</strong><span>{error.message}</span></div><button type="button" onClick={reload}>Retry</button></div>}

      <div className="diagnostic-summary-grid">
        <div className="diag-summary-card"><span>MARKET REGISTRY</span><strong>v{market?.registry?.version || "—"}</strong><small>{market ? providers.length : "—"} providers evaluated</small></div>
        <div className="diag-summary-card"><span>VERIFIED QUOTES</span><strong>{observations?.quotes?.verified ?? "—"}</strong><small>{observations?.quotes?.instrumentsObserved ?? "—"} observed · {observations?.quotes?.verifiedFresh ?? "—"} recent successes</small></div>
        <div className="diag-summary-card"><span>CANDLE INSTRUMENTS</span><strong>{observations?.candles?.withCandles ?? "—"}</strong><small>{observations?.candles?.failed ?? "—"} failed · {observations?.candles?.instrumentsObserved ?? "—"} observed</small></div>
        <div className="diag-summary-card"><span>PROVIDER CALLS</span><strong>{market?.requestStates?.requestAttempted ?? "—"}</strong><small>attempted · last {market ? requests.length : "—"} records</small></div>
        <div className="diag-summary-card"><span>AI KEYS</span><strong>{ai?.credentials?.dedicatedConfigured ?? "—"}/{ai?.credentials?.agentsConfigured ?? "—"}</strong><small>{!ai?.credentials ? "routing unknown" : ai.credentials.sharedFallback?.configured ? "shared fallback configured" : "no shared fallback"}</small></div>
        <div className="diag-summary-card"><span>AI REQUESTS</span><strong>{ai?.usage?.requests ?? "—"}</strong><small>{compactNumber(ai?.usage?.totalTokens)} tokens</small></div>
      </div>

      <div className="diagnostics-grid">
        <TerminalPanel kicker="MARKET DATA" title="Provider registry" actions={<button type="button" className="t-link" onClick={() => onNavigate("coverage")}>Open coverage <Icon name="arrowRight" size={12} /></button>} className="diag-provider-panel">
          <MarketTable columns={providerColumns} rows={providers} empty="Registry data unavailable." />
          <div className="diag-note"><Icon name="shield" size={12} /> Yahoo/yfinance is evaluated but rejected for automated use. No request is made.</div>
        </TerminalPanel>

        <TerminalPanel kicker="RUNTIME" title="Observation window" className="diag-observation-panel">
          <div className="kv-list">
            <div><span>Freshness window</span><strong>{observations?.freshnessWindowMinutes ?? "—"} min</strong></div>
            <div><span>Last quote success</span><strong>{formatTime(observations?.quotes?.lastSuccessAt)}</strong></div>
            <div><span>Last candle success</span><strong>{formatTime(observations?.candles?.lastSuccessAt)}</strong></div>
            <div><span>Observed quote failures</span><strong>{observations?.quotes?.failed ?? "—"}</strong></div>
            <div><span>Observed candle failures</span><strong>{observations?.candles?.failed ?? "—"}</strong></div>
            <div><span>Persistence</span><strong>per process</strong></div>
          </div>
          <p className="provenance-note">{observations?.note || "Observations reset on cold start."}</p>
        </TerminalPanel>

        <TerminalPanel kicker="AI ROUTING" title="Agents and credentials" actions={<button type="button" className="t-link" onClick={() => onNavigate("ai-usage")}>Open AI usage <Icon name="arrowRight" size={12} /></button>} className="diag-ai-panel">
          <div className="diag-agent-list">
            {agents.map((agent) => (
              <div key={agent.agent}>
                <span>{agent.agent}</span>
                <strong>{agent.model || "model unavailable"}</strong>
                <small>{credentialSelection(agent.credential, ai?.credentials?.sharedFallback).mode} · {credentialSelection(agent.credential, ai?.credentials?.sharedFallback).name} · {agent.usage?.requests ?? "—"} req</small>
              </div>
            ))}
          </div>
          <p className="provenance-note">{ai?.separation || "AI coverage and market-data coverage are measured separately."}</p>
        </TerminalPanel>

        <TerminalPanel kicker="REQUESTS" title="Recent market requests" actions={<span className="panel-chip">{market ? requests.length : "—"} inspected / {market?.recentRequests?.count ?? "—"} retained</span>} className="diag-request-panel">
          {requests.length ? <MarketTable columns={requestColumns} rows={requests.slice(0, 10)} empty="No requests observed." /> : <EmptyState compact icon="coverage" title="No request records" detail="No provider request records are available in this process." />}
          <p className="provenance-note">{market ? `Showing ${Math.min(requests.length, 10)} of the last ${requests.length} records: ${market.requestStates?.requestAttempted ?? "—"} attempted, ${market.requestStates?.notSent ?? "—"} not sent. ` : ""}{market?.recentRequests?.note || "No URLs, query strings or credentials are recorded."}</p>
        </TerminalPanel>

        <TerminalPanel kicker="COVERAGE" title="Exchange directory" className="diag-directory-panel">
          <div className="directory-grid">
            {Object.entries(market?.byExchange || {}).map(([exchange, summary]) => (
              <div key={exchange} className="directory-card">
                <span>{exchange}</span>
                <strong>{summary.catalogued ?? 0}</strong>
                <small>{summary.verified ?? 0} verified recently</small>
                <div className="directory-bar"><i style={{ width: `${summary.catalogued ? ((summary.verified || 0) / summary.catalogued) * 100 : 0}%` }} /></div>
              </div>
            ))}
          </div>
          <button type="button" className="t-btn secondary full" onClick={() => onNavigate("coverage")}>Inspect instrument matrix</button>
        </TerminalPanel>

        <TerminalPanel kicker="VERSIONS" title="Build contract" className="diag-version-panel">
          <div className="kv-list">
            <div><span>Market-data registry</span><strong>v{market?.registry?.version || "—"}</strong></div>
            <div><span>Provider registry snapshot</span><strong>{formatTime(market?.registry?.generatedAt)}</strong></div>
            <div><span>AI provider</span><strong>{ai?.provider || "—"}</strong></div>
            <div><span>AI telemetry</span><strong>{!ai?.telemetry ? "unknown" : ai.telemetry.persisted ? "persisted" : "per process"}</strong></div>
            <div><span>Diagnostics generated</span><strong>{formatTime(data?.generatedAt)}</strong></div>
            <div><span>Status light</span><DataStatus state={{ code: (observations?.quotes?.verifiedFresh || 0) > 0 ? "delayed" : "unavailable", label: !observations ? "UNKNOWN" : (observations.quotes?.verifiedFresh || 0) > 0 ? "QUOTES OBSERVED" : "NO VERIFIED QUOTES" }} compact /></div>
          </div>
          <EvidenceBadge tone="unverified">No secret values included</EvidenceBadge>
        </TerminalPanel>
      </div>
    </section>
  );
}
