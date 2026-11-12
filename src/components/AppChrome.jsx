import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

const VIEWS = [
  ["overview", "Overview", "Market"],
  ["charts", "Chart Lab", "Structure"],
  ["structure", "Structure", "Signals"],
  ["screener", "Screener", "Filters"],
  ["news", "News", "Events"],
  ["research", "Research", "Agents"],
  ["watchlists", "Watchlists", "Alerts"],
  ["portfolio", "Portfolio", "Virtual"]
];

/**
 * Shared terminal chrome. The status light is driven by the coverage matrix,
 * not by "one API responded": verified means recently observed quotes.
 */
export default function AppChrome({ view, onNavigate }) {
  const [coverage, setCoverage] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api("/api/coverage")
      .then((data) => {
        if (!cancelled) setCoverage(data?.instruments || null);
      })
      .catch(() => {
        if (!cancelled) setCoverage(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const verified = coverage?.coverage?.verifiedLatestQuote ?? null;
  const catalogued = coverage?.catalogued ?? null;
  const quoteEnabled = coverage?.coverage?.quoteEnabled ?? null;
  const tone = verified > 0 ? "live" : quoteEnabled > 0 ? "warn" : "bad";
  const statusLabel =
    verified === null
      ? "COVERAGE UNKNOWN"
      : verified === 0
        ? quoteEnabled > 0
          ? `NO VERIFIED QUOTES · ${quoteEnabled} CAPABLE`
          : "NO QUOTE PROVIDER"
        : `QUOTES ${verified}/${catalogued} VERIFIED`;

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
          <small>RESEARCH TERMINAL · INDIA FIRST</small>
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

      <div
        className="market-status"
        title={
          coverage
            ? `Catalogued ${catalogued}; quote-capable ${quoteEnabled}; verified recently ${verified}. ${coverage.freshness?.detail || ""}`
            : "Coverage matrix is loading or unavailable."
        }
      >
        <i className={`status-light ${tone}`} />
        {statusLabel}
        <span className="status-divider" />
        DELAYED
      </div>

      <div className="topbar-right">
        <span className="session-label">RESEARCH ONLY</span>
        <span className="avatar">ML</span>
      </div>
    </header>
  );
}
