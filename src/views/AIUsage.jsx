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

export default function AIUsage() {
  const { data, error, loading, reload } = useApiResource("/api/diagnostics", { intervalMs: 30_000 });
  const ai = data?.ai;
  const credentials = ai?.credentials;
  const agents = Object.values(ai?.agents || {});
  const runs = ai?.recentRuns || [];

  const agentColumns = [
    { key: "agent", label: "AGENT", value: (row) => row.agent, render: (row) => <strong>{row.agent}</strong> },
    { key: "model", label: "MODEL", value: (row) => row.model || "—", render: (row) => row.model || "—" },
    { key: "credential", label: "DEDICATED ENV (NAME ONLY)", value: (row) => row.credential?.envName || "", render: (row) => <span className="key-route"><code>{row.credential?.envName || "—"}</code><small>{row.credential ? row.credential.configured ? "configured" : "missing" : "unknown"}</small></span> },
    { key: "selected", label: "SELECTED ENV", value: (row) => credentialSelection(row.credential, credentials?.sharedFallback).name, render: (row) => <code>{credentialSelection(row.credential, credentials?.sharedFallback).name}</code> },
    { key: "mode", label: "MODE", value: (row) => credentialSelection(row.credential, credentials?.sharedFallback).mode },
    { key: "provider", label: "PROVIDER", value: (row) => row.provider || "groq" },
    { key: "requests", label: "REQUESTS", align: "right", value: (row) => row.usage?.requests || 0, render: (row) => row.usage?.requests ?? 0 },
    { key: "tokens", label: "TOTAL TOKENS", align: "right", value: (row) => row.usage?.totalTokens || 0, render: (row) => compactNumber(row.usage?.totalTokens) },
    { key: "recent", label: "RECENT RUNS", align: "right", value: (row) => row.recentRuns?.length || 0, render: (row) => row.recentRuns?.length ?? 0 }
  ];

  const runColumns = [
    { key: "at", label: "TIME", value: (row) => row.at || row.completedAt || "", render: (row) => <span className="muted">{formatTime(row.at || row.completedAt)}</span> },
    { key: "agent", label: "AGENT", value: (row) => row.agent },
    { key: "model", label: "MODEL", value: (row) => row.model || "—" },
    { key: "status", label: "STATUS", value: (row) => row.status || "", render: (row) => <span className="status-text">{row.status || "—"}</span> },
    { key: "duration", label: "MS", align: "right", value: (row) => row.durationMs || 0, render: (row) => row.durationMs ?? "—" },
    { key: "tokens", label: "TOKENS", align: "right", value: (row) => row.usage?.totalTokens ?? row.totalTokens ?? 0, render: (row) => compactNumber(row.usage?.totalTokens ?? row.totalTokens) }
  ];

  return (
    <section className="workspace ai-usage-workspace">
      <header className="workspace-head">
        <div>
          <span className="workspace-kicker">AI USAGE · SEPARATE FROM MARKET DATA</span>
          <h1>AI Usage</h1>
          <p>Credential routing, model configuration, token usage and run outcomes. Market-data coverage is measured separately.</p>
        </div>
        <div className="workspace-head-actions">
          <EvidenceBadge tone="unverified">No key values exposed</EvidenceBadge>
          <button type="button" className="t-btn secondary sm" onClick={reload} disabled={loading}><Icon name="refresh" size={13} className={loading ? "spin" : ""} /> Refresh</button>
        </div>
      </header>

      {error && <div className="inline-alert error" role="alert"><Icon name="warn" size={15} /><div><strong>AI usage unavailable</strong><span>{error.message}</span></div></div>}

      <div className="ai-summary-grid">
        <div><span>DEDICATED KEYS</span><strong>{credentials?.dedicatedConfigured ?? "—"}<small> / {credentials?.agentsConfigured ?? "—"}</small></strong><b className={credentials?.strictMode ? "warn" : "muted"}>{!credentials ? "ROUTING UNKNOWN" : credentials.strictMode ? "STRICT ROUTING" : credentials.sharedFallback?.permitted ? "FALLBACK ALLOWED" : "FALLBACK DISABLED"}</b></div>
        <div><span>SHARED FALLBACK</span><strong>{!credentials ? "—" : credentials.sharedFallback?.configured ? "KEY SET" : "KEY MISSING"}</strong><b className="muted">{credentials?.sharedFallback?.envName || "shared credential"} · {!credentials ? "policy unknown" : credentials.sharedFallback?.permitted ? "permitted" : "disabled"}</b></div>
        <div><span>REQUESTS</span><strong>{ai?.usage?.requests ?? "—"}</strong><b className="muted">current process telemetry</b></div>
        <div><span>PROMPT TOKENS</span><strong>{compactNumber(ai?.usage?.promptTokens)}</strong><b className="muted">input only</b></div>
        <div><span>COMPLETION TOKENS</span><strong>{compactNumber(ai?.usage?.completionTokens)}</strong><b className="muted">output only</b></div>
        <div><span>TOTAL TOKENS</span><strong>{compactNumber(ai?.usage?.totalTokens)}</strong><b className="muted">{!ai?.telemetry ? "telemetry unavailable" : ai.telemetry.persisted ? "persisted telemetry" : "resets on cold start"}</b></div>
      </div>

      <div className="ai-usage-grid">
        <TerminalPanel kicker="ROUTING MATRIX" title="Credential, mode and model per agent" className="ai-routing-panel">
          <MarketTable columns={agentColumns} rows={agents} empty="AI agent configuration unavailable." />
          <div className="ai-usage-note"><Icon name="lock" size={12} /> {ai?.separation || "AI coverage and market-data coverage are independent."}</div>
        </TerminalPanel>

        <TerminalPanel kicker="TELEMETRY" title="Recent agent runs" actions={<span className="panel-chip">{ai?.telemetry?.count ?? "—"} retained</span>} className="ai-runs-panel">
          {runs.length ? <MarketTable columns={runColumns} rows={runs.slice(0, 12)} empty="No runs recorded." /> : <EmptyState compact icon="ai" title={ai ? "No AI calls in this process" : "Telemetry unavailable"} detail={ai?.telemetry?.note || "A configured credential is not a successful live call."} />}
        </TerminalPanel>

        <TerminalPanel kicker="CREDENTIAL ROUTING" title="Key presence only" className="ai-credential-panel">
          <div className="credential-list">
            <div><span>Strict mode</span><DataStatus state={{ code: credentials?.strictMode ? "delayed" : "unavailable", label: !credentials ? "UNKNOWN" : credentials.strictMode ? "ENABLED" : "DISABLED" }} compact /></div>
            <div><span>Agent routes</span><strong>{credentials?.agentsConfigured ?? "—"}</strong></div>
            <div><span>Dedicated configured</span><strong>{credentials?.dedicatedConfigured ?? "—"}</strong></div>
            <div><span>Shared fallback</span><strong>{credentials?.sharedFallback?.envName || "—"}</strong></div>
            <div><span>Fallback configured</span><strong>{!credentials ? "—" : credentials.sharedFallback?.configured ? "yes" : "no"}</strong></div>
            <div><span>Fallback permitted</span><strong>{!credentials ? "—" : credentials.sharedFallback?.permitted ? "yes" : "no"}</strong></div>
            <div><span>Live model verification</span><strong>{ai?.liveModelVerification || "not verified"}</strong></div>
          </div>
          <p className="provenance-note">Only environment-variable names and modes are shown. Values, prefixes and authorization headers are never returned.</p>
        </TerminalPanel>

        <TerminalPanel kicker="POLICY" title="What this panel does not claim" className="ai-policy-panel">
          <div className="policy-list">
            <div><Icon name="x" size={12} /><span>AI connectivity is not market-data coverage.</span></div>
            <div><Icon name="x" size={12} /><span>Separate keys do not multiply organisation quotas.</span></div>
            <div><Icon name="x" size={12} /><span>A configured key is not a successful call.</span></div>
            <div><Icon name="check" size={12} /><span>Success is recorded per agent run and per model.</span></div>
            <div><Icon name="check" size={12} /><span>Each of six agents keeps its dedicated credential path.</span></div>
          </div>
          <div className="telemetry-meta">
            <span>{ai?.telemetry?.note || "Telemetry is process-local unless storage is configured."}</span>
            <span>Generated {formatTime(ai?.generatedAt)}</span>
          </div>
        </TerminalPanel>
      </div>
    </section>
  );
}
