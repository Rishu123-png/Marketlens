import { useEffect, useMemo, useState } from "react";
import Icon from "../components/terminal/Icon.jsx";
import TerminalPanel from "../components/terminal/TerminalPanel.jsx";
import InstrumentHeader from "../components/terminal/InstrumentHeader.jsx";
import CandlestickChart from "../components/terminal/CandlestickChart.jsx";
import AgentStatus from "../components/terminal/AgentStatus.jsx";
import EmptyState from "../components/terminal/EmptyState.jsx";
import DataStatus from "../components/terminal/DataStatus.jsx";
import PriceChange from "../components/terminal/PriceChange.jsx";
import PortfolioMetric from "../components/terminal/PortfolioMetric.jsx";
import Sparkline from "../components/terminal/Sparkline.jsx";
import InstrumentSearch from "../components/InstrumentSearch.jsx";
import { useChartData } from "../lib/useChartData.js";
import { useApiResource } from "../lib/useApi.js";
import { useVirtualAccount } from "../lib/useVirtualAccount.js";
import { usePersistentState } from "../lib/usePersistentState.js";
import { api, formatMoney, formatTime } from "../lib/api.js";
import { marketCoverage, quoteState, sessionLabel } from "../lib/marketVisuals.js";
import { defaultInstrument } from "../lib/instruments.js";

const FALLBACK_INDICES = [
  { id: "IN-IDX-NIFTY50", symbol: "^NSEI", name: "Nifty 50", exchange: "NSE", quote: null },
  { id: "IN-IDX-SENSEX", symbol: "^BSESN", name: "BSE Sensex", exchange: "BSE", quote: null },
  { id: "IN-IDX-NIFTYBANK", symbol: "^NSEBANK", name: "Nifty Bank", exchange: "NSE", quote: null },
  { symbol: "TCS", name: "Tata Consultancy Services", exchange: "NSE", quote: null }
];

const AGENTS = ["chart", "technical", "news", "sentiment", "risk", "coordinator"];
const SUGGESTED = [
  { id: "IN-EQ-TCS", symbol: "TCS", name: "Tata Consultancy Services", exchange: "NSE" },
  { id: "IN-EQ-HDFCBANK", symbol: "HDFCBANK", name: "HDFC Bank", exchange: "NSE" },
  { id: "IN-EQ-INFY", symbol: "INFY", name: "Infosys", exchange: "NSE" }
];

function IndexCard({ entry, onSelect }) {
  const quote = entry.quote;
  const state = quoteState(quote, undefined, { verifiedByContract: true });
  return (
    <button type="button" className="index-card" onClick={() => onSelect?.(entry)}>
      <div className="index-card-top">
        <span>{entry.name || entry.symbol}</span>
        <DataStatus state={state} compact />
      </div>
      <div className="index-card-value">
        <strong className={state.code !== "unavailable" ? "" : "is-empty"}>{state.code !== "unavailable" ? formatMoney(quote.price, quote.currency) : "—"}</strong>
        {state.code !== "unavailable" ? <PriceChange value={quote.changePercent} percent size="sm" /> : <small>NO VERIFIED QUOTE</small>}
      </div>
      <div className="index-card-foot">
        <span className="index-venue">{entry.exchange || "—"}</span>
        <Sparkline points={[]} width={112} height={26} label={state.detail} />
        <span className="index-source">{quote?.source || "provider pending"}</span>
      </div>
    </button>
  );
}

function WatchlistPulse({ onNavigate }) {
  const [watchlist, setWatchlist] = usePersistentState("marketlens-watchlist-v2", []);
  const [quotes, setQuotes] = useState({});
  const [failures, setFailures] = useState([]);
  const [batchError, setBatchError] = useState(null);

  useEffect(() => {
    setQuotes({});
    setFailures([]);
    setBatchError(null);
    if (!watchlist.length) return undefined;
    let cancelled = false;
    const targets = watchlist.slice(0, 8).map((entry) => `${entry.symbol}@${entry.exchange || "NSE"}`);
    api(`/api/quotes?symbols=${encodeURIComponent(targets.join(","))}`)
      .then((data) => {
        if (cancelled) return;
        setQuotes(Object.fromEntries((data.quotes || []).map((entry) => [
          `${entry.symbol}|${entry.quote?.exchange || entry.exchange || "NSE"}`,
          entry.quote
        ])));
        setFailures(data.failures || []);
      })
      .catch((error) => {
        if (!cancelled) { setQuotes({}); setBatchError(error.message || "Quote batch unavailable."); }
      });
    return () => { cancelled = true; };
  }, [watchlist]);

  function add(instrument) {
    setWatchlist((current) => current.some((item) => item.symbol === instrument.symbol && item.exchange === instrument.exchange)
      ? current
      : [...current, instrument]);
  }

  return (
    <TerminalPanel
      kicker="WATCHLIST PULSE"
      title="Tracked instruments"
      className="watchlist-pulse"
      actions={<button type="button" className="t-link" onClick={() => onNavigate("watchlist")}>Open <Icon name="chevronRight" size={12} /></button>}
    >
      {watchlist.length > 0 ? (
        <div className="pulse-list">
          {watchlist.slice(0, 4).map((item) => {
            const quote = quotes[`${item.symbol}|${item.exchange || "NSE"}`];
            const state = quoteState(quote);
            const usable = state.code !== "unavailable";
            return (
              <button type="button" className="pulse-row" key={`${item.symbol}|${item.exchange}`} onClick={() => onNavigate("markets", item)} title={state.detail}>
                <span className="pulse-monogram">{item.symbol.slice(0, 2)}</span>
                <span><strong>{item.symbol}</strong><small>{item.exchange}</small></span>
                <span className="pulse-value">{usable ? formatMoney(quote.price, quote.currency) : "—"}</span>
                {usable ? <PriceChange value={quote.changePercent} percent size="sm" /> : <DataStatus state={state} compact showLabel={false} />}
              </button>
            );
          })}
          {batchError && <p className="inline-note">Quote batch unavailable; no individual result was returned. Open Watchlist to retry.</p>}
          {!batchError && failures.length > 0 && <p className="inline-note">{failures.length} tracked instrument(s) have no verified quote.</p>}
        </div>
      ) : (
        <div className="watchlist-empty">
          <p>No saved instruments yet. Add a catalogued symbol — this does not imply a price exists.</p>
          <div className="quick-add-row">
            {SUGGESTED.map((instrument) => (
              <button key={instrument.id} type="button" onClick={() => add(instrument)}>
                <Icon name="plus" size={10} /> {instrument.symbol}
              </button>
            ))}
          </div>
        </div>
      )}
      <InstrumentSearch compact onSelect={add} placeholder="Add to watchlist…" />
    </TerminalPanel>
  );
}

export default function Overview({ overview, overviewError, coverage, onRefresh, onNavigate, loading, defaultExchange = "NSE" }) {
  const [quickScreen, setQuickScreen] = useState({ market: defaultExchange, sector: "", assetType: "equity" });
  const [watchlist] = usePersistentState("marketlens-watchlist-v2", []);
  const { account } = useVirtualAccount();
  const defaultSelection = defaultInstrument(defaultExchange);
  const chart = useChartData({ initialSymbol: defaultSelection.symbol, initialExchange: defaultSelection.exchange, initialName: defaultSelection.name, initialInterval: "1day", limit: 180 });
  const news = useApiResource("/api/news?symbol=TCS&exchange=NSE&limit=4&filings=false", { intervalMs: 180_000 });
  const jobs = useApiResource("/api/jobs", { intervalMs: 30_000 });
  const [latestRuns, setLatestRuns] = useState({});

  const latestJob = Array.isArray(jobs.data?.jobs) ? jobs.data.jobs[0] : null;
  useEffect(() => {
    setLatestRuns({});
    if (!latestJob?.jobId) return undefined;
    let cancelled = false;
    api(`/api/jobs/${encodeURIComponent(latestJob.jobId)}`)
      .then((detail) => { if (!cancelled) setLatestRuns(detail.agentRuns || {}); })
      .catch(() => { if (!cancelled) setLatestRuns({}); });
    return () => { cancelled = true; };
  }, [latestJob?.jobId]);

  const indices = useMemo(() => {
    const source = overview?.indices?.length ? overview.indices : FALLBACK_INDICES;
    const preferred = ["IN-IDX-NIFTY50", "IN-IDX-SENSEX", "IN-IDX-NIFTYBANK"];
    const ordered = preferred
      .map((id) => source.find((entry) => entry.id === id || entry.name === (id === "IN-IDX-NIFTY50" ? "Nifty 50" : id === "IN-IDX-SENSEX" ? "BSE Sensex" : "Nifty Bank")))
      .filter(Boolean);
    const remainder = source.filter((entry) => !ordered.includes(entry));
    return [...ordered, ...remainder].slice(0, 3);
  }, [overview]);
  const fourth = useMemo(() => {
    const stock = overview?.featuredStocks?.find((item) => item.symbol === "TCS")
      || [...(overview?.gainers || []), ...(overview?.losers || [])].find((item) => item.symbol === "TCS");
    return stock || FALLBACK_INDICES[3];
  }, [overview]);
  const coverageVerified = marketCoverage(coverage)?.verifiedLatestQuote;
  const breadthTotal = overview?.breadth?.changesAvailable ?? 0;
  const breadthAvailable = breadthTotal > 0 && overview?.breadth?.advancePercent != null;
  const bookValue = account.positions.reduce((sum, position) => sum + position.qty * position.avgCost, 0);
  const invested = bookValue;

  function openQuickScreen(event) {
    event.preventDefault();
    onNavigate("screener", {
      filters: {
        exchange: quickScreen.market,
        sector: quickScreen.sector,
        assetType: quickScreen.assetType
      }
    });
  }

  return (
    <section className="workspace overview-workspace">
      <header className="workspace-head">
        <div>
          <span className="workspace-kicker">MARKET OVERVIEW · INDIA FIRST</span>
          <h1>Market Overview</h1>
          <p>Institutional research view · values only appear when a configured provider verifies identity and returns data.</p>
        </div>
        <div className="workspace-head-actions">
          <span className="head-date">{sessionLabel(overview?.market).label} · {overview?.market?.istTime || "—"} IST · holidays unverified</span>
          <DataStatus state={{ code: coverageVerified > 0 ? "delayed" : "unavailable", label: coverageVerified == null ? "COVERAGE UNKNOWN" : coverageVerified > 0 ? "QUOTES OBSERVED" : "NO VERIFIED QUOTES" }} />
          <button type="button" className="t-btn secondary sm" onClick={onRefresh} disabled={loading}>
            <Icon name="refresh" size={13} className={loading ? "spin" : ""} /> Refresh
          </button>
        </div>
      </header>

      {overviewError && (
        <div className="inline-alert" role="alert">
          <Icon name="warn" size={15} />
          <div><strong>Market overview unavailable</strong><span>{overviewError.message || String(overviewError)}</span></div>
          <button type="button" onClick={() => onNavigate("coverage")}>Check coverage</button>
        </div>
      )}

      <div className="index-grid">
        {[...indices, fourth].slice(0, 4).map((entry, index) => (
          <IndexCard key={entry.id || entry.symbol || index} entry={entry} onSelect={(instrument) => onNavigate("markets", instrument)} />
        ))}
      </div>

      <div className="breadth-strip">
        <div className="breadth-block">
          <span>VERIFIED BREADTH</span>
          <strong className="value-up">{breadthAvailable ? overview.breadth.advancers : "—"}</strong><small>advancing</small>
          <strong className="value-down">{breadthAvailable ? overview.breadth.decliners : "—"}</strong><small>declining</small>
          <strong>{breadthAvailable ? overview.breadth.unchanged : "—"}</strong><small>unchanged</small>
        </div>
        <div className="breadth-meter" aria-hidden="true">
          {breadthAvailable && <>
            <i className="advance" style={{ width: `${overview.breadth.advancers / breadthTotal * 100}%` }} />
            <i className="unchanged" style={{ width: `${overview.breadth.unchanged / breadthTotal * 100}%` }} />
            <i className="decline" style={{ width: `${overview.breadth.decliners / breadthTotal * 100}%` }} />
          </>}
        </div>
        <span className="breadth-basis">
          {overview?.breadth?.verified != null
            ? `${overview.breadth.changesAvailable ?? "—"} with reported change · ${overview.breadth.verified}/${overview.breadth.universeAttempted} quotes verified`
            : "Awaiting verified quotes"}
        </span>
        <button type="button" className="t-link" onClick={() => onNavigate("coverage")}>
          Coverage {coverageVerified ?? "—"} verified observations <Icon name="chevronRight" size={12} />
        </button>
      </div>

      <div className="overview-main-grid">
        <TerminalPanel
          className="overview-chart"
          kicker="PRICE ACTION"
          title="Market chart"
          actions={<button type="button" className="t-link" onClick={() => onNavigate("markets", chart.instrument)}>Open Markets <Icon name="arrowRight" size={12} /></button>}
        >
          <InstrumentHeader
            instrument={chart.instrument}
            quote={chart.quote}
            quoteError={chart.quoteError}
            compact
            actions={
              <div className="chart-head-tools">
                <div className="timeframe-mini" role="group" aria-label="Preview timeframe">
                  {[["1day", "1D"], ["1week", "1W"], ["1month", "1M"]].map(([value, label]) => (
                    <button key={value} type="button" className={chart.interval === value ? "active" : ""} onClick={() => chart.chooseInterval(value)}>{label}</button>
                  ))}
                </div>
                <button type="button" className="square-btn" onClick={chart.refresh} aria-label="Refresh chart"><Icon name="refresh" size={13} /></button>
              </div>
            }
          />
          <CandlestickChart
            analysis={chart.analysis}
            loading={chart.loading}
            error={chart.error}
            height={280}
            overlays={(chart.analysis?.series?.ema20 ? [{ label: "EMA 20", color: "#e3b25f", data: chart.analysis.series.ema20 }, { label: "SMA 50", color: "#2f9bff", data: chart.analysis.series.sma50 }] : [])}
            emptyDetail="Preview uses the same verified candle path as Markets. No simulated series is drawn."
            onCoverage={() => onNavigate("coverage")}
          />
          <div className="chart-footer-strip">
            <span><b>{chart.analysis?.chart?.trend?.label?.replaceAll("-", " ") || "STRUCTURE PENDING"}</b> trend</span>
            <span>ATR {chart.analysis?.indicators?.atr?.toFixed?.(2) ?? "—"}</span>
            <span>RSI {chart.analysis?.indicators?.rsi?.toFixed?.(2) ?? "—"}</span>
            <span>{chart.analysis?.coverage?.count ?? 0} candles</span>
            <span className="chart-footer-right">Deterministic indicators · v{chart.analysis?.versions?.indicators || "—"}</span>
          </div>
        </TerminalPanel>

        <div className="overview-side-stack">
          <TerminalPanel
            className="ai-preview"
            kicker="AI RESEARCH DEPARTMENT"
            title="AI Analyst"
            actions={<span className="agent-count"><Icon name="sparkle" size={12} /> 6 agents</span>}
          >
            <div className="ai-preview-glow" aria-hidden="true" />
            <p className="ai-preview-sub">Deep insights with a multi-agent evidence trail.</p>
            <div className="agent-stack">
              {AGENTS.map((agent) => <AgentStatus key={agent} agent={agent} run={latestRuns[agent]} depth={latestJob?.depth} compact />)}
            </div>
            <div className="ai-preview-foot">
              <span>{latestJob ? `${latestJob.status} · ${latestJob.depth}` : "No research job run yet"}</span>
              <button type="button" className="t-btn primary sm" onClick={() => onNavigate("research", chart.instrument)}>
                Generate report <Icon name="arrowRight" size={12} />
              </button>
            </div>
          </TerminalPanel>

          <WatchlistPulse onNavigate={onNavigate} />
        </div>
      </div>

      <div className="overview-bottom-grid">
        <TerminalPanel
          kicker="STOCK SCREENER"
          title="Find opportunities"
          actions={<button type="button" className="t-link" onClick={() => onNavigate("screener")}>Advanced filters <Icon name="filter" size={11} /></button>}
          className="quick-screen"
        >
          <form onSubmit={openQuickScreen} className="quick-screen-form">
            <label><span>MARKET</span><select value={quickScreen.market} onChange={(event) => setQuickScreen({ ...quickScreen, market: event.target.value })}><option>NSE</option><option>BSE</option><option>NASDAQ</option><option>NYSE</option></select></label>
            <label><span>SECTOR</span><select value={quickScreen.sector} onChange={(event) => setQuickScreen({ ...quickScreen, sector: event.target.value })}><option value="">All sectors</option><option>Banking</option><option>Information Technology</option><option>Energy</option><option>Consumer Goods</option><option>Automotive</option></select></label>
            <label><span>ASSET TYPE</span><select value={quickScreen.assetType} onChange={(event) => setQuickScreen({ ...quickScreen, assetType: event.target.value })}><option value="equity">Equity</option><option value="etf">ETF</option></select></label>
            <button type="submit" className="t-btn primary full"><Icon name="play" size={11} /> Run Screener</button>
          </form>
          <div className="popular-row">
            <span>POPULAR PICKS</span>
            {["IT", "Banking", "Pharma", "Energy"].map((sector) => (
              <button key={sector} type="button" onClick={() => onNavigate("screener", { filters: { sector: sector === "IT" ? "Information Technology" : sector === "Pharma" ? "Healthcare" : sector } })}>{sector}</button>
            ))}
          </div>
        </TerminalPanel>

        <TerminalPanel
          kicker="VIRTUAL TRADING"
          title="Simulation account"
          actions={<span className="simulation-badge"><i /> Simulation mode</span>}
          className="trading-preview"
        >
          <div className="trading-preview-top">
            <PortfolioMetric
              label="PORTFOLIO VALUE"
              value={formatMoney(account.cash + invested)}
              icon="wallet"
              change={<PriceChange value={null} percent />}
              detail={account.positions.length ? `${account.positions.length} simulated positions · valued at cost` : "No simulated positions"}
            />
            <div className="mini-equity">
              <Sparkline points={account.equityHistory.map((point) => point.equity)} width={220} height={52} label="Simulated account equity history" />
              <span>{account.equityHistory.length > 1 ? "Simulated marked equity" : "Equity curve appears after marked refreshes"}</span>
            </div>
          </div>
          <div className="trading-preview-metrics">
            <div><span>AVAILABLE CASH</span><strong>{formatMoney(account.cash)}</strong></div>
            <div><span>INVESTED</span><strong>{formatMoney(invested)}</strong></div>
            <div><span>POSITIONS</span><strong>{account.positions.length}</strong></div>
            <div><span>P&amp;L</span><strong className="muted">Awaiting verified marks</strong></div>
          </div>
          <button type="button" className="t-btn secondary full" onClick={() => onNavigate("trading")}>
            Open simulation · no broker <Icon name="arrowRight" size={12} />
          </button>
        </TerminalPanel>

        <TerminalPanel
          kicker="MARKET NEWS"
          title="Latest sourced headlines"
          actions={<button type="button" className="t-link" onClick={() => onNavigate("news")}>View all <Icon name="arrowRight" size={12} /></button>}
          className="news-preview"
        >
          {news.loading && <div className="panel-loading">Loading evidence…</div>}
          {!news.loading && (news.data?.evidence || []).length === 0 && (
            <EmptyState compact icon="news" title="No headlines returned" detail="RSS and filing coverage may be unconfigured. This is not “no news exists”." action={<button type="button" className="t-link" onClick={() => onNavigate("news")}>Check sources</button>} />
          )}
          <div className="news-preview-list">
            {(news.data?.evidence || []).slice(0, 3).map((item) => (
              <button key={item.id || item.url} type="button" className="news-preview-row" onClick={() => onNavigate("news")}>
                <span className="news-preview-mark">{item.publisher?.slice(0, 2)?.toUpperCase() || "NW"}</span>
                <span>
                  <strong>{item.metadata?.title || item.excerpt?.slice(0, 96) || "Untitled evidence"}</strong>
                  <small>{item.publisher} · {item.publishedAt ? `Published ${formatTime(item.publishedAt)}` : "Publication time unavailable"}</small>
                </span>
                <Icon name="chevronRight" size={12} />
              </button>
            ))}
          </div>
          <div className="news-preview-foot">
            <span>{news.data?.counts?.returned ?? 0} returned · {news.data?.counts?.rejected ?? 0} rejected</span>
            <span>Untrusted text</span>
          </div>
        </TerminalPanel>
      </div>

      <div className="overview-footnote">
        <span><Icon name="info" size={12} /> Values are never synthetic. Unavailable states are part of the product, not a loading placeholder.</span>
        <span>{watchlist.length} watchlist instruments · {overview?.indices?.filter((entry) => entry.quote).length ?? 0}/4 indices verified · quotes {coverageVerified ?? "—"}</span>
      </div>
    </section>
  );
}
