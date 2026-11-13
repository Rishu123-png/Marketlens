import { useMemo, useState } from "react";
import Icon from "../components/terminal/Icon.jsx";
import TerminalPanel from "../components/terminal/TerminalPanel.jsx";
import MarketTable from "../components/terminal/MarketTable.jsx";
import DataStatus from "../components/terminal/DataStatus.jsx";
import EvidenceBadge from "../components/terminal/EvidenceBadge.jsx";
import EmptyState from "../components/terminal/EmptyState.jsx";
import { useApiResource } from "../lib/useApi.js";
import { formatTime } from "../lib/api.js";

// Kept local: these are provider declarations, not quotes.
const INTERVAL_LABELS = {
  quote: "Quote", "1min": "1m", "5min": "5m", "15min": "15m", "30min": "30m",
  "1h": "1H", "4h": "4H", "1day": "1D", "1week": "1W", "1month": "1M"
};

const INTERVALS = ["quote", "1min", "5min", "15min", "30min", "1h", "4h", "1day", "1week", "1month"];

export default function Coverage() {
  const { data, error, loading, reload } = useApiResource("/api/diagnostics", { intervalMs: 60_000 });
  const market = data?.market;
  const registry = market?.registry;
  const providers = Object.values(registry?.providers || {});
  const matrix = market?.instrumentMatrix || [];
  const intervalCoverage = market?.intervalCoverage || {};
  const selectionPlans = market?.providerSelection || {};
  const [query, setQuery] = useState("");
  const [exchange, setExchange] = useState("");
  const [assetType, setAssetType] = useState("");
  const [coverageFilter, setCoverageFilter] = useState("all");

  const rows = useMemo(() => matrix.filter((instrument) => {
    const needle = query.trim().toLowerCase();
    if (needle && !`${instrument.symbol} ${instrument.name}`.toLowerCase().includes(needle)) return false;
    if (exchange && instrument.exchange !== exchange) return false;
    if (assetType && instrument.assetType !== assetType) return false;
    if (coverageFilter === "mapped" && !instrument.availability?.quoteSupported) return false;
    if (coverageFilter === "verified" && !instrument.availability?.quoteVerifiedRecently) return false;
    if (coverageFilter === "unavailable" && !instrument.availability?.unavailableFromAllConfigured) return false;
    return true;
  }), [matrix, query, exchange, assetType, coverageFilter]);

  const columns = [
    {
      key: "symbol",
      label: "INSTRUMENT",
      value: (row) => row.symbol,
      render: (row) => <div className="table-instrument"><span>{row.symbol.slice(0, 2)}</span><div><strong>{row.symbol}</strong><small>{row.name}</small></div></div>
    },
    { key: "exchange", label: "VENUE", value: (row) => row.exchange },
    { key: "assetType", label: "TYPE", value: (row) => row.assetType },
    { key: "mapped", label: "MAPPED", value: (row) => row.availability?.quoteMappedProviders?.length || 0, render: (row) => (row.availability?.quoteMappedProviders || []).join(", ") || "—" },
    { key: "configured", label: "CONFIGURED", value: (row) => row.availability?.quoteProviders?.length || 0, render: (row) => (row.availability?.quoteProviders || []).join(", ") || "—" },
    { key: "quote", label: "QUOTE OBSERVED", value: (row) => Boolean(row.availability?.quoteVerifiedRecently), render: (row) => <DataStatus state={{ code: row.availability?.quoteVerifiedRecently ? "delayed" : "unavailable", label: row.availability?.quoteVerifiedRecently ? "VERIFIED" : "NONE" }} compact /> },
    { key: "candles", label: "CANDLES", value: (row) => row.availability?.lastCandleCount || 0, render: (row) => row.availability?.lastCandleCount ? `${row.availability.lastCandleCount} rows` : "—" },
    { key: "last", label: "LAST SUCCESS", value: (row) => row.availability?.lastQuoteAt || "", render: (row) => <span className="muted">{formatTime(row.availability?.lastQuoteAt)}</span> },
    { key: "identity", label: "IDENTITY", value: (row) => row.lotSizeStatus || "catalog", render: (row) => <span className="status-text">{row.lotSizeStatus || "catalog"}</span> }
  ];

  return (
    <section className="workspace coverage-workspace">
      <header className="workspace-head">
        <div>
          <span className="workspace-kicker">MARKET DATA COVERAGE · PROVIDER REGISTRY</span>
          <h1>Market Data Coverage</h1>
          <p>Declared support, configured mappings and observed coverage are separate states. Only identity-checked observations count as verified.</p>
        </div>
        <div className="workspace-head-actions">
          <span className="head-date">REGISTRY v{registry?.version || "—"} · {providers.length} PROVIDERS</span>
          <button type="button" className="t-btn secondary sm" onClick={reload} disabled={loading}><Icon name="refresh" size={13} className={loading ? "spin" : ""} /> Refresh</button>
        </div>
      </header>

      {error && <div className="inline-alert error" role="alert"><Icon name="warn" size={15} /><div><strong>Coverage unavailable</strong><span>{error.message}</span></div></div>}

      <div className="coverage-summary-grid">
        <div><span>CATALOGUED</span><strong>{market ? matrix.length : "—"}</strong><small>identities in the catalog</small></div>
        <div><span>QUOTE-MAPPED</span><strong>{market ? matrix.filter((row) => row.availability?.quoteSupported).length : "—"}</strong><small>at least one adapter mapping</small></div>
        <div><span>QUOTE-CONFIGURED</span><strong>{market ? matrix.filter((row) => row.availability?.quoteEnabled).length : "—"}</strong><small>requires an API key</small></div>
        <div><span>VERIFIED RECENTLY</span><strong>{market ? matrix.filter((row) => row.availability?.quoteVerifiedRecently).length : "—"}</strong><small>identity checked in this process</small></div>
        <div><span>NO CONFIGURED PATH</span><strong>{market ? matrix.filter((row) => row.availability?.unavailableFromAllConfigured).length : "—"}</strong><small>explicitly unavailable</small></div>
      </div>

      <div className="coverage-provider-grid">
        {providers.map((provider) => (
          <article key={provider.id} className={`provider-card ${provider.status}`}>
            <header>
              <div><span className="provider-mark">{provider.id.slice(0, 2).toUpperCase()}</span><div><strong>{provider.label}</strong><small>{provider.kind} · {provider.envName}</small></div></div>
              <span className={`mode-pill ${provider.status}`}>{provider.status}</span>
            </header>
            <div className="provider-facts">
              <div><span>KEY</span><b className={provider.configured ? "value-up" : "value-down"}>{provider.configured ? "CONFIGURED" : "MISSING"}</b></div>
              <div><span>CIRCUIT</span><b>{provider.health?.circuit || "unknown"}</b></div>
              <div><span>REALTIME</span><b>{provider.quote?.realtime ? "CLAIMED" : "NOT CLAIMED"}</b></div>
              <div><span>VERIFICATION</span><b>{provider.verification?.live ? "LIVE OBSERVED" : provider.verification?.declared ? "DECLARED" : "UNVERIFIED"}</b></div>
            </div>
            <p>{provider.licensing?.display}</p>
            <footer>
              <span>{provider.quote?.freshness || "no quote"}</span>
              <span>{provider.rateLimits?.notes ? provider.rateLimits.notes.slice(0, 80) : "rate limits runtime"}</span>
            </footer>
          </article>
        ))}
        {!providers.length && <EmptyState icon="coverage" title="Registry unavailable" detail="The diagnostics endpoint did not return provider descriptors." />}
      </div>

      <TerminalPanel kicker="EXCHANGE × INTERVAL" title="Declared interval coverage" actions={<EvidenceBadge tone="unverified">Declared ≠ verified</EvidenceBadge>} className="interval-coverage-panel">
        <div className="interval-scroll-hint">Scroll horizontally for more intervals <span aria-hidden="true">→</span></div>
        <div className="interval-matrix-wrap" tabIndex={0} role="region" aria-label="Exchange interval coverage; scroll horizontally for more intervals">
          <table className="interval-matrix">
            <thead><tr><th>EXCHANGE</th>{INTERVALS.map((interval) => <th key={interval}>{INTERVAL_LABELS[interval]}</th>)}</tr></thead>
            <tbody>
              {Object.entries(intervalCoverage).map(([venue, intervals]) => (
                <tr key={venue}>
                  <th>{venue}<small>{intervals["1day"]?.catalogued ?? 0} instruments</small></th>
                  {INTERVALS.map((interval) => {
                    const cell = intervals[interval];
                    return (
                      <td key={interval} title={cell ? `${cell.status} · declared: ${cell.declaredProviders.join(", ") || "none"} · configured: ${cell.configuredProviders.join(", ") || "none"}` : "not reported"}>
                        <span className={`interval-cell ${cell?.status || "unknown"}`}>
                          <b>{cell?.declaredProviders?.length ?? 0}</b>
                          <small>{cell?.status === "configured-unverified" ? "cfg" : cell?.status === "declared-not-configured" ? "decl" : cell?.status === "unavailable" ? "—" : "?"}</small>
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="interval-legend">
          <span><i className="declared" /> Declared, no key</span>
          <span><i className="configured" /> Configured, unverified</span>
          <span><i className="unavailable" /> Unavailable</span>
          <span className="interval-legend-note">Numbers show declared providers. “Verified” is never inferred from this matrix.</span>
        </div>
      </TerminalPanel>

      <div className="coverage-grid">
        <div className="coverage-main">
          <TerminalPanel kicker="INSTRUMENT MATRIX" title={market ? `${rows.length} instrument(s)` : "Instrument matrix unavailable"} className="instrument-matrix-panel">
            <div className="matrix-toolbar">
              <label className="matrix-search"><Icon name="search" size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter symbol or company…" /></label>
              <select value={exchange} onChange={(event) => setExchange(event.target.value)}><option value="">All venues</option>{[...new Set(matrix.map((row) => row.exchange).filter(Boolean))].map((venue) => <option key={venue}>{venue}</option>)}</select>
              <select value={assetType} onChange={(event) => setAssetType(event.target.value)}><option value="">All types</option>{[...new Set(matrix.map((row) => row.assetType).filter(Boolean))].map((type) => <option key={type}>{type}</option>)}</select>
              <div className="coverage-filter-tabs">
                {[["all", "All"], ["mapped", "Mapped"], ["verified", "Verified"], ["unavailable", "Unavailable"]].map(([value, label]) => <button key={value} type="button" className={coverageFilter === value ? "active" : ""} onClick={() => setCoverageFilter(value)}>{label}</button>)}
              </div>
            </div>
            <MarketTable columns={columns} rows={rows} empty="No instrument matches this coverage filter." />
            <div className="table-footer-strip"><span>{market?.honesty?.note || "Supported is not verified."}</span><span>{matrix.length} catalogued</span></div>
          </TerminalPanel>
        </div>

        <aside className="coverage-side">
          <TerminalPanel kicker="SELECTION PLANS" title="Representative instruments" className="selection-panel">
            <div className="selection-list">
              {Object.entries(selectionPlans).map(([id, plan]) => (
                <details key={id}>
                  <summary><span><strong>{plan.instrument?.symbol || id}</strong><small>{plan.instrument?.exchange} · {plan.instrument?.assetType}</small></span><span className={`selection-state ${plan.quote?.selected ? "selected" : "none"}`}>{plan.quote?.selected ? plan.quote.selected : "NO PROVIDER"}</span></summary>
                  <div className="selection-detail">
                    <div><span>QUOTE SELECTED</span><strong>{plan.quote?.selected || "none"}</strong><small>{(plan.quote?.providers || []).map((candidate) => `${candidate.provider}:${candidate.state}`).join(" · ") || "no candidates"}</small></div>
                    <div><span>DAILY CANDLES</span><strong>{plan.dailyCandles?.selected || "none"}</strong><small>{(plan.dailyCandles?.providers || []).map((candidate) => `${candidate.provider}:${candidate.state}`).join(" · ") || "no candidates"}</small></div>
                  </div>
                </details>
              ))}
              {!Object.keys(selectionPlans).length && <p className="inline-note">Selection plans unavailable.</p>}
            </div>
          </TerminalPanel>

          <TerminalPanel kicker="COVERAGE CAVEATS" title="How to read this" className="coverage-caveats">
            <ul className="limitation-list">
              {(registry?.hedging || []).map((line, index) => <li key={index}>{line}</li>)}
              <li>A provider’s declared exchange list is not an entitlement for every instrument on that exchange.</li>
              <li>Observed counters reset on serverless cold start.</li>
            </ul>
          </TerminalPanel>

          <TerminalPanel kicker="DATA REQUEST" title="Need a licensed feed?" className="coverage-callout">
            <p className="panel-paragraph">NSE/BSE real-time display requires an exchange licence. This build never represents a developer API key as one.</p>
            <button type="button" className="t-btn secondary full" onClick={() => window.open("/api/diagnostics", "_blank", "noopener")}>Open raw diagnostics</button>
          </TerminalPanel>
        </aside>
      </div>
    </section>
  );
}
