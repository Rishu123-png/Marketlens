import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/terminal/Icon.jsx";
import TerminalPanel from "../components/terminal/TerminalPanel.jsx";
import MarketTable from "../components/terminal/MarketTable.jsx";
import PriceChange from "../components/terminal/PriceChange.jsx";
import EmptyState from "../components/terminal/EmptyState.jsx";
import DataStatus from "../components/terminal/DataStatus.jsx";
import EvidenceBadge from "../components/terminal/EvidenceBadge.jsx";
import { api, formatMoney, formatPercent, formatTime } from "../lib/api.js";
import { compactNumber, numberOrNull, preciseNumber, quoteState } from "../lib/marketVisuals.js";
import { ASSET_LABELS } from "../lib/instruments.js";
import { usePersistentState, uid } from "../lib/usePersistentState.js";

const SECTORS = ["", "Banking", "Information Technology", "Energy", "Consumer Goods", "Automotive", "Pharmaceuticals", "Healthcare", "Metals", "Utilities", "Financial Services", "Industrials", "Cement", "Telecom", "Real Estate", "Chemicals", "Defence", "Retail", "Internet", "Infrastructure"];

const BLANK = {
  assetType: "equity",
  exchange: "",
  sector: "",
  priceMin: "",
  priceMax: "",
  changeMin: "",
  changeMax: "",
  volumeMin: "",
  smaCondition: "",
  rsiMin: "",
  rsiMax: "",
  universeLimit: "40",
  technicalLimit: "12"
};

const PRESETS = [
  ["Momentum", { changeMin: "0", smaCondition: "aboveSma50", rsiMin: "50" }],
  ["Oversold", { rsiMax: "35" }],
  ["High volume", { volumeMin: "500000", universeLimit: "60" }],
  ["Above SMA 200", { smaCondition: "aboveSma200", technicalLimit: "12" }]
];

function normaliseFilters(filters = {}) {
  return Object.fromEntries(Object.entries({ ...BLANK, ...filters }).map(([key, value]) => [key, value === null || value === undefined ? "" : String(value)]));
}

function buildQuery(filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== "" && value !== null && value !== undefined) params.set(key, value);
  }
  return params.toString();
}

export default function Screener({ focus, onNavigate }) {
  const [filters, setFilters] = useState(() => normaliseFilters(focus?.filters));
  const [result, setResult] = useState(null);
  const [executedFilters, setExecutedFilters] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [advanced, setAdvanced] = useState(false);
  const [screens, setScreens] = usePersistentState("marketlens-saved-screens-v2", []);
  const [screenName, setScreenName] = useState("");
  const [resultQuery, setResultQuery] = useState("");
  const requestRef = useRef(0);
  const abortRef = useRef(null);
  useEffect(() => () => { requestRef.current += 1; abortRef.current?.abort(); }, []);
  const visibleRows = useMemo(() => {
    const needle = resultQuery.trim().toLowerCase();
    return (result?.rows || []).filter((row) => !needle || `${row.symbol} ${row.name} ${row.exchange}`.toLowerCase().includes(needle));
  }, [result, resultQuery]);
  const noUniverse = result?.universe?.pool === 0;
  const noQuotes = result && !noUniverse && result.universe?.verifiedQuotes === 0;
  const incompleteTechnical = (result?.universe?.technicalSkipped ?? 0) > 0 || (result?.technicalErrors?.length ?? 0) > 0;
  const resultTitle = !result ? "Screening results" : noUniverse ? "No instruments in selected universe" : noQuotes ? "No verified quotes to screen" : `${result.matched} matching instruments${!result.matched && incompleteTechnical ? " · incomplete evaluation" : ""}`;
  const emptyMessage = noUniverse
    ? "No catalogued instruments match the selected universe filters."
    : noQuotes
      ? "No verified quotes were available in this universe. Check market-data coverage before interpreting this screen."
      : result?.matched > 0 && resultQuery.trim()
        ? "No returned instruments match this search."
        : incompleteTechnical
          ? "No matches among evaluated instruments. Some technical data was skipped or unavailable."
          : "No verified instruments matched these filters.";

  function update(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  async function execute(nextFilters = filters) {
    const id = ++requestRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setResult(null);
    setExecutedFilters(null);
    setError(null);
    try {
      const payload = await api(`/api/screener?${buildQuery(nextFilters)}`, { signal: controller.signal });
      if (requestRef.current === id) { setResult(payload); setExecutedFilters(normaliseFilters(nextFilters)); }
    } catch (cause) {
      if (requestRef.current === id) setError({ message: cause.message, details: cause.details, status: cause.status });
    } finally {
      if (requestRef.current === id) setLoading(false);
    }
  }

  function applyPreset(patch) {
    const next = { ...filters, ...patch };
    setFilters(next);
    execute(next);
  }

  function saveScreen(nameValue = screenName, filtersValue = filters) {
    const name = nameValue.trim() || `Screen ${screens.length + 1}`;
    setScreens((current) => [...current, { id: uid("screen"), name, filters: normaliseFilters(filtersValue), createdAt: new Date().toISOString() }].slice(-20));
    setScreenName("");
  }

  const columns = useMemo(() => [
    {
      key: "symbol",
      label: "INSTRUMENT",
      value: (row) => row.symbol,
      render: (row) => (
        <div className="table-instrument">
          <span>{row.symbol.slice(0, 2)}</span>
          <div><strong>{row.symbol}</strong><small>{row.name} · {row.exchange || row.sector}</small></div>
        </div>
      )
    },
    { key: "price", label: "PRICE", align: "right", value: (row) => numberOrNull(row.price), render: (row) => formatMoney(row.price, row.currency) },
    { key: "changePercent", label: "CHANGE", align: "right", value: (row) => numberOrNull(row.changePercent), render: (row) => <PriceChange value={row.changePercent} percent size="sm" /> },
    { key: "dataState", label: "DATA STATE", value: (row) => quoteState(row, undefined, { verifiedByContract: true }).code, render: (row) => <DataStatus state={quoteState(row, undefined, { verifiedByContract: true })} compact /> },
    { key: "volume", label: "VOLUME", align: "right", value: (row) => numberOrNull(row.volume), render: (row) => compactNumber(row.volume) },
    { key: "rsi", label: "RSI", align: "right", value: (row) => row.indicators?.rsi ?? null, render: (row) => preciseNumber(row.indicators?.rsi) },
    { key: "sma50", label: "SMA 50", align: "right", value: (row) => row.indicators?.sma50 ?? null, render: (row) => preciseNumber(row.indicators?.sma50) },
    { key: "sma200", label: "SMA 200", align: "right", value: (row) => row.indicators?.sma200 ?? null, render: (row) => preciseNumber(row.indicators?.sma200) },
    { key: "relvol", label: "REL VOL", align: "right", value: (row) => row.indicators?.relativeVolume ?? null, render: (row) => preciseNumber(row.indicators?.relativeVolume) },
    { key: "technicalStatus", label: "TECH", value: (row) => row.technicalStatus, render: (row) => <span className="status-text">{row.technicalStatus}</span> },
    {
      key: "actions",
      label: "",
      sortable: false,
      width: 84,
      render: (row) => <button type="button" className="table-action" onClick={(event) => { event.stopPropagation(); onNavigate("research", row); }}>Research</button>
    }
  ], [onNavigate]);

  return (
    <section className="workspace screener-workspace">
      <header className="workspace-head">
        <div>
          <span className="workspace-kicker">SCREENER · VERIFIED UNIVERSE</span>
          <h1>Stock Screener</h1>
          <p>Quote filters use verified prices only. Technical filters are evaluated on a bounded subset; skipped instruments are counted, not silently treated as matches.</p>
        </div>
        <div className="workspace-head-actions">
          <EvidenceBadge tone="verified">No market-cap estimate</EvidenceBadge>
          <button type="button" className="t-btn secondary sm" onClick={() => execute()} disabled={loading}><Icon name="play" size={12} /> Run screen</button>
        </div>
      </header>

      <TerminalPanel className="screen-builder" bodyClassName="screen-builder-body">
        <div className="screen-builder-head">
          <div><span className="t-kicker">FILTER BUILDER</span><h2>Build a screen</h2></div>
          <div className="preset-row">
            <span>QUICK PRESETS</span>
            {PRESETS.map(([label, patch]) => <button key={label} type="button" onClick={() => applyPreset(patch)}>{label}</button>)}
            <button type="button" className={`advanced-toggle ${advanced ? "is-open" : ""}`.trim()} onClick={() => setAdvanced((value) => !value)}><Icon name="filter" size={11} /> Advanced filters</button>
          </div>
        </div>

        <form onSubmit={(event) => { event.preventDefault(); execute(); }} className="screen-filters">
          <label><span>ASSET TYPE</span><select value={filters.assetType} onChange={(event) => update("assetType", event.target.value)}><option value="">All equities &amp; ETFs</option><option value="equity">Equity</option><option value="etf">ETF</option></select></label>
          <label><span>EXCHANGE</span><select value={filters.exchange} onChange={(event) => update("exchange", event.target.value)}><option value="">Any</option>{["NSE", "BSE", "NASDAQ", "NYSE"].map((exchange) => <option key={exchange}>{exchange}</option>)}</select></label>
          <label><span>SECTOR</span><select value={filters.sector} onChange={(event) => update("sector", event.target.value)}>{SECTORS.map((sector) => <option key={sector} value={sector}>{sector || "All sectors"}</option>)}</select></label>
          <label><span>PRICE RANGE</span><div className="range-pair"><input type="number" step="any" value={filters.priceMin} onChange={(event) => update("priceMin", event.target.value)} placeholder="Min" /><input type="number" step="any" value={filters.priceMax} onChange={(event) => update("priceMax", event.target.value)} placeholder="Max" /></div></label>
          <label><span>CHANGE %</span><div className="range-pair"><input type="number" step="any" value={filters.changeMin} onChange={(event) => update("changeMin", event.target.value)} placeholder="Min" /><input type="number" step="any" value={filters.changeMax} onChange={(event) => update("changeMax", event.target.value)} placeholder="Max" /></div></label>
          <label><span>UNIVERSE LIMIT</span><select value={filters.universeLimit} onChange={(event) => update("universeLimit", event.target.value)}>{["20", "40", "60"].map((value) => <option key={value}>{value}</option>)}</select></label>
          <button type="submit" className="t-btn primary" disabled={loading}><Icon name={loading ? "refresh" : "play"} size={12} className={loading ? "spin" : ""} /> {loading ? "Screening…" : "Run Screen"}</button>
        </form>

        {advanced && (
          <div className="screen-filters advanced-filters">
            <label><span>VOLUME MIN</span><input type="number" step="any" value={filters.volumeMin} onChange={(event) => update("volumeMin", event.target.value)} placeholder="100000" /></label>
            <label><span>MOVING AVERAGE</span><select value={filters.smaCondition} onChange={(event) => update("smaCondition", event.target.value)}><option value="">Any</option><option value="aboveSma50">Price &gt; SMA 50</option><option value="belowSma50">Price &lt; SMA 50</option><option value="aboveSma200">Price &gt; SMA 200</option><option value="belowSma200">Price &lt; SMA 200</option></select></label>
            <label><span>RSI RANGE</span><div className="range-pair"><input type="number" step="any" value={filters.rsiMin} onChange={(event) => update("rsiMin", event.target.value)} placeholder="Min" /><input type="number" step="any" value={filters.rsiMax} onChange={(event) => update("rsiMax", event.target.value)} placeholder="Max" /></div></label>
            <label><span>TECHNICAL LIMIT</span><select value={filters.technicalLimit} onChange={(event) => update("technicalLimit", event.target.value)}>{["6", "12"].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label><span>SAVE SCREEN</span><div className="save-screen"><input value={screenName} onChange={(event) => setScreenName(event.target.value)} placeholder="Screen name" /><button type="button" className="t-btn secondary sm" onClick={() => saveScreen()}>Save</button></div></label>
          </div>
        )}

        {screens.length > 0 && (
          <div className="saved-screens-row">
            <span>SAVED IN THIS BROWSER</span>
            {screens.map((screen) => (
              <span key={screen.id} className="saved-screen">
                <button type="button" onClick={() => { const saved = normaliseFilters(screen.filters); setFilters(saved); execute(saved); }}>{screen.name}</button>
                <button type="button" onClick={() => setScreens((current) => current.filter((item) => item.id !== screen.id))} aria-label={`Delete ${screen.name}`}><Icon name="x" size={9} /></button>
              </span>
            ))}
          </div>
        )}
      </TerminalPanel>

      {error && (
        <div className="inline-alert error" role="alert">
          <Icon name="warn" size={15} />
          <div><strong>{error.status === 503 ? "Screening data unavailable" : "Screen rejected"}</strong><span>{error.message}</span>{Array.isArray(error.details) && error.details.slice(0, 3).map((line, index) => <span key={index}>{line}</span>)}</div>
          <button type="button" onClick={() => onNavigate("coverage")}>Check coverage</button>
        </div>
      )}

      {result && (
        <div className="screen-summary-strip">
          <div><span>UNIVERSE</span><strong>{result.universe.pool}</strong></div>
          <div><span>VERIFIED QUOTES</span><strong>{result.universe.verifiedQuotes}</strong></div>
          <div><span>QUOTE MATCHES</span><strong>{result.universe.quoteMatched}</strong></div>
          <div><span>TECH EVALUATED</span><strong>{result.universe.technicalEvaluated}</strong></div>
          <div><span>FINAL MATCHES</span><strong>{result.matched}</strong></div>
          <div className="summary-time"><span>RETRIEVED</span><strong>{formatTime(result.generatedAt)}</strong></div>
          <div className="summary-actions"><EvidenceBadge tone="delayed">{ASSET_LABELS[result.filters.assetType] || "Mixed universe"}</EvidenceBadge><button type="button" className="t-link" onClick={() => saveScreen(`${result.filters.assetType || "market"} screen`, executedFilters)}>Save this screen</button></div>
        </div>
      )}

      <div className="screener-grid">
        <TerminalPanel
          kicker="RESULTS"
          title={resultTitle}
          actions={result ? <label className="matrix-search"><Icon name="search" size={13} /><input aria-label="Search screening results" value={resultQuery} onChange={(event) => setResultQuery(event.target.value)} placeholder="Search results…" /></label> : <span className="panel-chip">Sortable columns</span>}
          className="screener-results-panel"
        >
          {!result && !loading && <EmptyState icon="screener" title="No screen has been run" detail="Set filters and run the screen. Rows appear only when a provider-verified quote exists." action={<button type="button" className="t-btn secondary sm" onClick={() => execute()}>Run default screen</button>} />}
          {result && <MarketTable columns={columns} rows={visibleRows} onRowClick={(row) => onNavigate("markets", row)} empty={emptyMessage} />}
          {result && <div className="table-footer-strip"><span>{result.limitations?.[0] || ""}</span><span>{visibleRows.length} displayed · {result.universe.technicalSkipped ?? 0} skipped · {result.technicalErrors?.length ?? 0} technical errors</span></div>}
        </TerminalPanel>

        <aside className="screener-side">
          <TerminalPanel kicker="DATA COVERAGE" title="What this screen can see">
            {result ? (
              <div className="coverage-list">
                <div><span>Quote matches</span><strong>{result.universe.quoteMatched}</strong></div>
                <div><span>Technical evaluated</span><strong>{result.universe.technicalEvaluated}</strong></div>
                <div><span>Technical skipped</span><strong>{result.universe.technicalSkipped ?? 0}</strong></div>
                <div><span>Technical errors</span><strong>{result.technicalErrors?.length ?? 0}</strong></div>
                <div><span>Assets</span><strong>{ASSET_LABELS[result.filters.assetType] || "Mixed"}</strong></div>
              </div>
            ) : <p className="inline-note">Coverage numbers appear after a screen is run.</p>}
            <p className="provenance-note"><Icon name="info" size={11} /> No market-cap filter is offered because a verified market-cap series is not configured.</p>
            <button type="button" className="t-btn secondary full" onClick={() => onNavigate("coverage")}>Open coverage workspace</button>
          </TerminalPanel>

          <TerminalPanel kicker="LIMITATIONS" title="How to read the rows">
            <ul className="limitation-list">
              {(result?.limitations || [
                "Only instruments with provider-verified quotes can satisfy price or change filters.",
                "Technical filters require candle history and are evaluated on a bounded subset.",
                "Unavailable indicators render as “—”; they are never estimated.",
                "Screening is research support, not a recommendation or order instruction."
              ]).map((line, index) => <li key={index}>{line}</li>)}
            </ul>
          </TerminalPanel>

          <TerminalPanel kicker="RECENT PRESETS" title="Research shortcuts">
            <div className="research-shortcuts">
              <button type="button" onClick={() => onNavigate("markets")}><Icon name="candle" size={13} /><span><strong>Open Markets</strong><small>Charts, structure and indicators</small></span></button>
              <button type="button" onClick={() => onNavigate("research")}><Icon name="ai" size={13} /><span><strong>AI Analyst</strong><small>Six-agent report on a chosen symbol</small></span></button>
              <button type="button" onClick={() => onNavigate("strategy")}><Icon name="strategy" size={13} /><span><strong>Strategy Lab</strong><small>Deterministic historical test</small></span></button>
            </div>
          </TerminalPanel>
        </aside>
      </div>
    </section>
  );
}
