import { useEffect, useState } from "react";

const VIEWS = [
  ["overview", "Overview", "Market"],
  ["charts", "Chart Lab", "Structure"],
  ["research", "Research", "Agents"]
];

/** Shared terminal chrome: brand, view navigation and data-feed status. */
export default function AppChrome({ view, onNavigate }) {
  const [quoteCount, setQuoteCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/top-stocks")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.stocks)) setQuoteCount(data.stocks.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <header className="topbar">
      <a
        className="brand"
        href="#top"
        aria-label="MarketLens home"
        onClick={(event) => {
          event.preventDefault();
          onNavigate("overview");
        }}
      >
        <span className="brand-mark">M</span>
        <span>
          <strong>
            market<span>lens</span>
          </strong>
          <small>RESEARCH TERMINAL · INDIA-FIRST</small>
        </span>
      </a>

      <nav className="view-nav" aria-label="Sections">
        {VIEWS.map(([id, label, hint]) => (
          <button
            key={id}
            className={view === id ? "view-link active" : "view-link"}
            aria-current={view === id ? "page" : undefined}
            onClick={() => onNavigate(id)}
          >
            <span>{label}</span>
            <small>{hint}</small>
          </button>
        ))}
      </nav>

      <div className="market-status">
        <i className={quoteCount ? "status-light live" : "status-light"} />
        {quoteCount ? "DATA FEED CONNECTED" : "MARKET DATA FEED"}
        <span className="status-divider" />
        NSE · INDIA
      </div>

      <div className="topbar-right">
        <span className="session-label">RESEARCH ONLY</span>
        <span className="avatar">ML</span>
      </div>
    </header>
  );
}
