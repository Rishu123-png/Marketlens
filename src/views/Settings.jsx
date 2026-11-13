import { useState } from "react";
import Icon from "../components/terminal/Icon.jsx";
import TerminalPanel from "../components/terminal/TerminalPanel.jsx";
import EvidenceBadge from "../components/terminal/EvidenceBadge.jsx";
import { useApiResource } from "../lib/useApi.js";

const ENV_NAMES = [
  "FMP_API_KEY",
  "TWELVE_DATA_API_KEY",
  "ALPHA_VANTAGE_API_KEY",
  "PRIMARY_MARKET_PROVIDER",
  "SECONDARY_MARKET_PROVIDER",
  "DATABASE_URL",
  "QSTASH_TOKEN",
  "WORKER_URL",
  "GROQ_API_KEY",
  "GROQ_AGENT_KEYS_REQUIRED",
  "AI_TOOL_CALLING",
  "AI_TOOL_AGENTS"
];

const LOCAL_KEYS = [
  "marketlens-owner-id",
  "marketlens-watchlist-v2",
  "marketlens-alerts-v1",
  "marketlens-virtual-account-v2",
  "marketlens-saved-screens-v2",
  "marketlens-preferences-v2"
];

export default function Settings({ settings, onSettingsChange, onNavigate }) {
  const { data } = useApiResource("/api/diagnostics", { intervalMs: 120_000 });
  const [cleared, setCleared] = useState(false);
  const registry = data?.market?.registry;
  const providers = Object.values(registry?.providers || {});

  function update(key, value) {
    onSettingsChange({ ...settings, [key]: value });
  }

  function clearLocal() {
    if (!window.confirm("Clear browser-local watchlists, alerts, simulated positions, saved screens and preferences? The browser identity is also cleared: existing server jobs will not be deleted, but this browser will lose access to them.")) return;
    for (const key of LOCAL_KEYS) {
      try { window.localStorage.removeItem(key); } catch { /* storage can be disabled */ }
    }
    setCleared(true);
    // Reload so mounted hooks cannot write stale in-memory values back to storage.
    window.location.reload();
  }

  return (
    <section className="workspace settings-workspace">
      <header className="workspace-head">
        <div>
          <span className="workspace-kicker">SETTINGS · BROWSER LOCAL</span>
          <h1>Settings</h1>
          <p>Display preferences, local data controls and the environment-variable names the server expects. No secret values are shown.</p>
        </div>
        <div className="workspace-head-actions"><EvidenceBadge tone="verified">Research only</EvidenceBadge></div>
      </header>

      <div className="settings-grid">
        <TerminalPanel kicker="APPEARANCE" title="Terminal density" className="settings-panel">
          <div className="setting-row">
            <div><strong>Density</strong><small>Compact matches the desktop terminal; comfortable increases row height.</small></div>
            <div className="segmented-control">
              {[["compact", "Compact"], ["comfortable", "Comfortable"]].map(([value, label]) => (
                <button key={value} type="button" className={settings.density === value ? "active" : ""} onClick={() => update("density", value)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <div><strong>Motion preferences</strong><small>Use reduced motion for loaders and hover transitions.</small></div>
            <button type="button" className={`toggle-switch ${settings.reduceMotion ? "on" : ""}`.trim()} onClick={() => update("reduceMotion", !settings.reduceMotion)} aria-label="Reduce motion" aria-pressed={settings.reduceMotion}><i /></button>
          </div>
          <div className="setting-row">
            <div><strong>Unavailable-data emphasis</strong><small>Keep explicit no-provider states visible. Disabling this never turns missing data into a price.</small></div>
            <button type="button" className={`toggle-switch ${settings.emphasiseUnavailable ? "on" : ""}`.trim()} onClick={() => update("emphasiseUnavailable", !settings.emphasiseUnavailable)} aria-label="Emphasise unavailable data" aria-pressed={settings.emphasiseUnavailable}><i /></button>
          </div>
        </TerminalPanel>

        <TerminalPanel kicker="MARKET DATA" title="Refresh and defaults" className="settings-panel">
          <div className="setting-row">
            <div><strong>Shared refresh interval</strong><small>How often the overview and coverage endpoints are polled.</small></div>
            <select value={settings.refreshSeconds} onChange={(event) => update("refreshSeconds", Number(event.target.value))}>
              <option value={60}>60 seconds</option><option value={120}>2 minutes</option><option value={180}>3 minutes</option><option value={300}>5 minutes</option>
            </select>
          </div>
          <div className="setting-row">
            <div><strong>Default exchange</strong><small>Used when a workspace has no explicit instrument focus.</small></div>
            <select value={settings.defaultExchange} onChange={(event) => update("defaultExchange", event.target.value)}>
              {["NSE", "BSE", "NASDAQ", "NYSE"].map((exchange) => <option key={exchange}>{exchange}</option>)}
            </select>
          </div>
          <div className="setting-row">
            <div><strong>Default research depth</strong><small>Quick skips news; standard adds news; comprehensive adds sentiment.</small></div>
            <select value={settings.defaultDepth} onChange={(event) => update("defaultDepth", event.target.value)}>
              <option value="quick">Quick</option><option value="standard">Standard</option><option value="comprehensive">Comprehensive</option>
            </select>
          </div>
          <div className="setting-row">
            <div><strong>Provider registry</strong><small>Current snapshot. Provider declarations do not create NSE/BSE entitlement.</small></div>
            <button type="button" className="t-link" onClick={() => onNavigate("coverage")}>v{registry?.version || "—"} · {data ? providers.length : "—"} providers <Icon name="arrowRight" size={12} /></button>
          </div>
        </TerminalPanel>

        <TerminalPanel kicker="PRIVACY" title="Browser-local data" className="settings-panel">
          <div className="local-data-list">
            {LOCAL_KEYS.map((key) => <code key={key}>{key}</code>)}
          </div>
          <p className="panel-paragraph">Watchlists, simulated positions and saved screens stay in this browser. Research jobs are owner-scoped with an opaque browser key; no password or brokerage credential is stored.</p>
          <button type="button" className="t-btn danger full" onClick={clearLocal}><Icon name="x" size={12} /> Clear local terminal data</button>
          {cleared && <p className="inline-note">Local keys were cleared. Reload the page to start from an empty workspace.</p>}
        </TerminalPanel>

        <TerminalPanel kicker="SERVER CONFIG" title="Environment variable names" className="settings-panel env-panel">
          <div className="env-name-grid">{ENV_NAMES.map((name) => <code key={name}>{name}</code>)}</div>
          <p className="provenance-note"><Icon name="lock" size={11} /> Names only. This page cannot read or display environment values.</p>
        </TerminalPanel>

        <TerminalPanel kicker="ABOUT" title="Market Lens 2.0" className="settings-panel about-panel">
          <div className="about-brand"><span className="brand-symbol small"><Icon name="markets" size={18} /></span><div><strong>Market Lens</strong><small>Research · Learn · Trade (Virtual)</small></div></div>
          <div className="kv-list">
            <div><span>Build</span><strong>Desktop terminal redesign</strong></div>
            <div><span>AI system</span><strong>Six specialist agents · Groq</strong></div>
            <div><span>Execution</span><strong className="value-down">No broker integration</strong></div>
            <div><span>Data mode</span><strong>{!data ? "unknown" : providers.some((provider) => provider.configured) ? "configured providers" : "no market provider keys"}</strong></div>
          </div>
          <p className="provenance-note">No guarantee of returns. No investment advice. No real-money order path exists.</p>
        </TerminalPanel>

        <TerminalPanel kicker="SUPPORT" title="Diagnostics shortcuts" className="settings-panel">
          <div className="settings-shortcuts">
            <button type="button" onClick={() => onNavigate("diagnostics")}><Icon name="diagnostics" size={14} /><span><strong>Diagnostics</strong><small>Provider health and request telemetry</small></span></button>
            <button type="button" onClick={() => onNavigate("coverage")}><Icon name="coverage" size={14} /><span><strong>Coverage</strong><small>Registry, intervals and identity matrix</small></span></button>
            <button type="button" onClick={() => onNavigate("ai-usage")}><Icon name="usage" size={14} /><span><strong>AI Usage</strong><small>Models and credentials by name</small></span></button>
          </div>
        </TerminalPanel>
      </div>
    </section>
  );
}
