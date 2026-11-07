import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { STOCK_UNIVERSE } from "../lib/stock-universe.js";
import "./styles.css";

const money = (value) => {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "—";
  return `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
};

const percent = (value) => {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
};

const compactNumber = (value) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value));
};

function readWatchlist() {
  try {
    const saved = JSON.parse(localStorage.getItem("marketlens-watchlist") || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function App() {
  const [universe, setUniverse] = useState(STOCK_UNIVERSE);
  const [extraStocks, setExtraStocks] = useState([]);
  const [quotes, setQuotes] = useState({});
  const [watchlist, setWatchlist] = useState(readWatchlist);
  const [activeView, setActiveView] = useState("all");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState("");
  const [marketMessage, setMarketMessage] = useState("");
  const [selected, setSelected] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");

  async function refreshMarket(showLoading = true) {
    if (showLoading) setRefreshing(true);
    setMarketMessage("");
    try {
      const response = await fetch("/api/top-stocks");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Live market quotes are unavailable.");
      const nextQuotes = Object.fromEntries((data.stocks || []).map((stock) => [stock.symbol, stock]));
      setQuotes(nextQuotes);
      setUpdatedAt(data.generatedAt || new Date().toISOString());
      if (!Object.keys(nextQuotes).length) setMarketMessage("No provider-verified quotes are available right now.");
    } catch (error) {
      setMarketMessage(error instanceof Error ? error.message : "Live market quotes are unavailable.");
    } finally {
      if (showLoading) setRefreshing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/universe")
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!cancelled && Array.isArray(data?.stocks) && data.stocks.length) setUniverse(data.stocks);
      })
      .catch(() => {});
    refreshMarket(false);
    const timer = window.setInterval(() => refreshMarket(false), 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("marketlens-watchlist", JSON.stringify(watchlist));
  }, [watchlist]);

  const allStocks = useMemo(() => {
    const seen = new Set();
    return [...universe, ...extraStocks].filter((stock) => {
      const key = `${stock.symbol}|${stock.exchange}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [universe, extraStocks]);

  const visibleStocks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allStocks.filter((stock) => {
      if (activeView === "watchlist" && !watchlist.includes(stock.symbol)) return false;
      const change = Number(quotes[stock.symbol]?.changePercent);
      if (activeView === "gainers" && !(change > 0)) return false;
      if (activeView === "losers" && !(change < 0)) return false;
      if (!needle) return true;
      return `${stock.symbol} ${stock.name} ${stock.sector || ""}`.toLowerCase().includes(needle);
    });
  }, [allStocks, activeView, watchlist, query, quotes]);

  const movers = useMemo(() => Object.values(quotes)
    .filter((stock) => stock.changePercent !== null && stock.changePercent !== undefined && stock.changePercent !== "" && Number.isFinite(Number(stock.changePercent)))
    .sort((a, b) => Number(b.changePercent) - Number(a.changePercent)), [quotes]);

  async function searchProviderStocks(event) {
    event?.preventDefault();
    const value = query.trim();
    if (value.length < 2) return;
    setSearching(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Provider search is unavailable.");
      setExtraStocks((current) => {
        const keys = new Set(current.map((stock) => `${stock.symbol}|${stock.exchange}`));
        const additions = [];
        for (const stock of data.results || []) {
          const key = `${stock.symbol}|${stock.exchange}`;
          if (!keys.has(key)) {
            keys.add(key);
            additions.push(stock);
          }
        }
        return [...current, ...additions];
      });
      if (!data.results?.length) setMarketMessage("No additional provider matches. The popular stock list is still available below.");
    } catch (error) {
      setMarketMessage(error instanceof Error ? error.message : "Provider search is unavailable.");
    } finally {
      setSearching(false);
    }
  }

  function toggleWatchlist(symbol) {
    setWatchlist((current) => current.includes(symbol)
      ? current.filter((item) => item !== symbol)
      : [...current, symbol]);
  }

  async function selectStock(stock) {
    setSelected({ ...stock, loading: true });
    setQuoteLoading(true);
    setAnalysis(null);
    setAnalysisError("");
    try {
      const response = await fetch(`/api/market?symbol=${encodeURIComponent(stock.symbol)}&exchange=${encodeURIComponent(stock.exchange || "")}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No verified quote is available.");
      if (data.quoteVerified !== true || data.price === null || data.price === undefined) throw new Error("No provider-verified price was returned.");
      setSelected({ ...stock, ...data, mode: "verified", loading: false });
    } catch (error) {
      setSelected({ ...stock, loading: false, quoteError: error instanceof Error ? error.message : "Unable to load a verified quote." });
    } finally {
      setQuoteLoading(false);
    }
  }

  async function analyzeStock() {
    if (!selected || selected.mode !== "verified") return;
    setAnalyzing(true);
    setAnalysis(null);
    setAnalysisError("");
    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stock: { symbol: selected.symbol, exchange: selected.exchange || "" } })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI analysis is unavailable.");
      setAnalysis(data.report);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Unable to generate analysis.");
    } finally {
      setAnalyzing(false);
    }
  }

  const quoteCount = Object.keys(quotes).length;

  return (
    <div className="terminal">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="MarketLens home">
          <span className="brand-mark">M</span>
          <span><strong>market<span>lens</span></strong><small>INDIA MARKET TERMINAL</small></span>
        </a>
        <div className="market-status"><i className={quoteCount ? "status-light live" : "status-light"} />{quoteCount ? "LIVE DATA CONNECTED" : "MARKET DATA FEED"}<span className="status-divider" />NSE · INDIA</div>
        <div className="topbar-right"><span className="session-label">CASH MARKET</span><span className="avatar">RL</span></div>
      </header>

      <main className="page-shell" id="top">
        <section className="page-heading">
          <div>
            <div className="eyebrow">MARKET OVERVIEW <span className="eyebrow-date">· {new Date().toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}</span></div>
            <h1>Markets <span>at a glance.</span></h1>
            <p>Your market watchlist, all in one place. The popular NSE stocks below load automatically.</p>
          </div>
          <div className="heading-actions"><span className="last-updated">{updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "Quotes update when available"}</span><button className="refresh-button" onClick={() => refreshMarket()} disabled={refreshing}><span className={refreshing ? "refresh-icon spinning" : "refresh-icon"}>↻</span>{refreshing ? "Refreshing" : "Refresh"}</button></div>
        </section>

        <section className="summary-grid" aria-label="Market summary">
          <article className="summary-card"><div className="summary-label">POPULAR STOCKS <span>01</span></div><strong>{allStocks.length}</strong><small>Curated NSE listings</small></article>
          <article className="summary-card"><div className="summary-label">VERIFIED QUOTES <span>02</span></div><strong>{quoteCount}<small className="summary-total"> / {allStocks.length}</small></strong><small>{quoteCount ? "Provider prices loaded" : "Waiting for data provider"}</small></article>
          <article className="summary-card"><div className="summary-label">WATCHLIST <span>03</span></div><strong>{watchlist.length}</strong><small>Saved on this device</small></article>
          <article className="summary-card data-card"><div className="summary-label">DATA STATUS <span>04</span></div><strong className={quoteCount ? "data-live" : "data-waiting"}>{quoteCount ? "Connected" : "Not connected"}</strong><small>{quoteCount ? "Quotes are provider verified" : "Configure a market data API key"}</small></article>
        </section>

        {marketMessage && <div className="market-notice"><span>i</span><div><strong>Live quote update</strong><p>{marketMessage}</p></div><button onClick={() => setMarketMessage("")} aria-label="Dismiss message">×</button></div>}

        <section className="market-layout">
          <div className="market-panel instruments-panel">
            <div className="panel-toolbar">
              <div><span className="section-kicker">YOUR MARKET</span><h2>Stocks <span className="stock-count">{visibleStocks.length}</span></h2></div>
              <form className="instrument-search" onSubmit={searchProviderStocks}>
                <span className="search-icon">⌕</span>
                <input aria-label="Filter stocks" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter stocks or sectors" />
                {query && <button type="button" className="clear-search" onClick={() => setQuery("")} aria-label="Clear filter">×</button>}
                <button type="submit" className="provider-search" disabled={searching || query.trim().length < 2}>{searching ? "Searching…" : "Search market"}</button>
              </form>
            </div>

            <div className="view-tabs" role="tablist" aria-label="Stock filters">
              {[ ["all", "All stocks"], ["gainers", "Gainers"], ["losers", "Losers"], ["watchlist", "Watchlist"] ].map(([view, label]) => <button key={view} role="tab" aria-selected={activeView === view} className={activeView === view ? "view-tab active" : "view-tab"} onClick={() => setActiveView(view)}>{label}{view === "watchlist" && <span>{watchlist.length}</span>}</button>)}
            </div>

            <div className="table-scroll">
              <table className="stocks-table">
                <thead><tr><th>INSTRUMENT</th><th>LAST PRICE</th><th>CHANGE</th><th>VOLUME</th><th>EXCHANGE</th><th><span className="sr-only">Watchlist</span></th></tr></thead>
                <tbody>
                  {visibleStocks.map((stock) => {
                    const quote = quotes[stock.symbol];
                    const positive = Number(quote?.changePercent) >= 0;
                    const saved = watchlist.includes(stock.symbol);
                    return <tr key={`${stock.symbol}-${stock.exchange}`}>
                      <td><button className="instrument-cell" onClick={() => selectStock(stock)}><span className="ticker-icon">{stock.symbol.replace(/[^A-Z]/g, "").slice(0, 2) || "IN"}</span><span className="instrument-text"><strong>{stock.symbol}</strong><small>{stock.name}</small></span></button></td>
                      <td><span className="table-price">{money(quote?.price)}</span></td>
                      <td><span className={quote ? `change-pill ${positive ? "positive" : "negative"}` : "not-quoted"}>{quote ? percent(quote.changePercent) : "—"}</span></td>
                      <td className="volume-cell">{compactNumber(quote?.volume)}</td>
                      <td><span className="exchange-tag">{stock.exchange}</span></td>
                      <td><button className={saved ? "watch-star saved" : "watch-star"} onClick={() => toggleWatchlist(stock.symbol)} aria-label={saved ? `Remove ${stock.symbol} from watchlist` : `Add ${stock.symbol} to watchlist`} title={saved ? "Remove from watchlist" : "Add to watchlist"}>{saved ? "★" : "☆"}</button></td>
                    </tr>;
                  })}
                  {!visibleStocks.length && <tr><td colSpan="6" className="table-empty">{activeView === "watchlist" ? "Your watchlist is empty. Star a stock to save it here." : "No stocks match this filter. Try provider search above."}</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="table-footer"><span>Showing {visibleStocks.length} of {allStocks.length} popular listings</span><span>Prices only shown when verified by a provider</span></div>
          </div>

          <aside className="side-column">
            <section className="market-panel side-panel">
              <div className="side-panel-heading"><div><span className="section-kicker">PERSONAL</span><h2>Watchlist</h2></div><button className="text-action" onClick={() => setActiveView("watchlist")}>View all ↗</button></div>
              {watchlist.length ? <div className="side-list">{allStocks.filter((stock) => watchlist.includes(stock.symbol)).slice(0, 5).map((stock) => <button className="side-stock" key={stock.symbol} onClick={() => selectStock(stock)}><span className="ticker-icon small">{stock.symbol.replace(/[^A-Z]/g, "").slice(0, 2) || "IN"}</span><span><strong>{stock.symbol}</strong><small>{stock.name}</small></span><b>{money(quotes[stock.symbol]?.price)}</b></button>)}</div> : <div className="side-empty"><span className="bookmark-icon">☆</span><strong>Build your watchlist</strong><p>Star any stock in the table to keep it close.</p></div>}
            </section>

            <section className="market-panel side-panel movers-panel">
              <div className="side-panel-heading"><div><span className="section-kicker">PROVIDER DATA</span><h2>Top movers</h2></div><span className="live-tag"><i />{quoteCount ? "LIVE" : "—"}</span></div>
              {movers.length ? <div className="mover-list">{[...movers.slice(0, 3), ...movers.slice(-2).reverse()].filter((stock, index, items) => items.findIndex((item) => item.symbol === stock.symbol) === index).map((stock) => <button className="mover-row" key={stock.symbol} onClick={() => selectStock(stock)}><span className="mover-symbol">{stock.symbol}</span><span className="mover-name">{stock.name}</span><span className={Number(stock.changePercent) >= 0 ? "mover-change positive-text" : "mover-change negative-text"}>{percent(stock.changePercent)}</span></button>)}</div> : <div className="side-empty compact"><strong>Waiting for verified prices</strong><p>Connect a market-data provider to populate live movers.</p></div>}
            </section>

            <div className="integrity-card"><span className="integrity-icon">✓</span><div><strong>Verified data only</strong><p>Unavailable prices stay blank. MarketLens never fills gaps with estimates.</p></div></div>
          </aside>
        </section>

        <footer className="dashboard-footer"><span>MARKETLENS <i>·</i> MARKET RESEARCH TERMINAL</span><span>Popular NSE list is curated, not the complete NSE/BSE security master. Not investment advice.</span></footer>
      </main>

      {selected && <div className="modal-backdrop" onClick={() => { if (!quoteLoading && !analyzing) { setSelected(null); setAnalysis(null); } }}>
        <section className="quote-modal" role="dialog" aria-modal="true" aria-labelledby="quote-title" onClick={(event) => event.stopPropagation()}>
          <button className="modal-close" onClick={() => { setSelected(null); setAnalysis(null); }} aria-label="Close quote">×</button>
          {selected.loading || quoteLoading ? <div className="modal-loading"><span className="loader" />Loading provider-verified quote…</div> : selected.quoteError ? <><span className="section-kicker">QUOTE UNAVAILABLE</span><h2 id="quote-title">{selected.symbol}</h2><div className="market-notice modal-notice"><span>!</span><p>{selected.quoteError}</p></div><p className="modal-footnote">Prices are not estimated when a provider cannot verify them.</p></> : selected.mode === "verified" ? <>
            <div className="modal-kicker"><span className="verified-mark">✓</span> VERIFIED QUOTE · {selected.exchange}</div>
            <h2 id="quote-title">{selected.name || selected.symbol}</h2>
            <div className="quote-symbol">{selected.symbol}</div>
            <div className="modal-price-line"><strong>{money(selected.price)}</strong><span className={Number(selected.changePercent) >= 0 ? "positive-text" : "negative-text"}>{percent(selected.changePercent)}</span></div>
            <div className="quote-metrics"><div><small>OPEN</small><strong>{money(selected.open)}</strong></div><div><small>PREVIOUS CLOSE</small><strong>{money(selected.previousClose)}</strong></div><div><small>DAY HIGH</small><strong>{money(selected.dayHigh)}</strong></div><div><small>DAY LOW</small><strong>{money(selected.dayLow)}</strong></div><div><small>VOLUME</small><strong>{compactNumber(selected.volume)}</strong></div><div><small>SOURCE</small><strong>{selected.source || "Provider"}</strong></div></div>
            <p className="quote-updated">Updated {selected.updatedAt ? new Date(selected.updatedAt).toLocaleString("en-IN") : "time not supplied"}</p>
            <button className="analyze-button" onClick={analyzeStock} disabled={analyzing}>{analyzing ? "Preparing analysis…" : "Explain this quote with AI"}<span>↗</span></button>
            {analysisError && <div className="api-error compact-error">{analysisError}</div>}
            {analysis && <div className="analysis-card"><span className="section-kicker">AI · VERIFIED DATA ONLY</span><h3>{analysis.headline || "Market analysis"}</h3><p>{analysis.summary}</p><strong>Market read</strong><p>{analysis.marketRead}</p><strong>Risks and uncertainty</strong><p>{Array.isArray(analysis.risks) ? analysis.risks.join(" · ") : analysis.risks}</p><strong>What to monitor</strong><p>{Array.isArray(analysis.whatToMonitor) ? analysis.whatToMonitor.join(" · ") : analysis.whatToMonitor}</p><small>{analysis.limitations}</small></div>}
          </> : null}
        </section>
      </div>}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
