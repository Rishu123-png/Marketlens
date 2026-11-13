import { useEffect, useRef, useState } from "react";
import Icon from "./terminal/Icon.jsx";
import DataStatus from "./terminal/DataStatus.jsx";
import GlobalSearch from "./GlobalSearch.jsx";
import MarketTicker from "./terminal/MarketTicker.jsx";
import { marketCoverage, sessionLabel } from "../lib/marketVisuals.js";

const PRIMARY_NAV = [
  ["overview", "Overview", "Market Overview", "home"],
  ["markets", "Markets", "Charts & Structure", "markets"],
  ["screener", "Screener", "Find Stocks", "screener"],
  ["news", "News & Events", "Latest Updates", "news"],
  ["research", "AI Analyst", "Research Reports", "ai"],
  ["strategy", "Strategy Lab", "Backtest Strategies", "strategy"],
  ["trading", "Virtual Trading", "Practice & Learn", "trading"],
  ["watchlist", "Watchlist", "Track Stocks", "watchlist"]
];

const ADMIN_NAV = [
  ["diagnostics", "Diagnostics", "diagnostics"],
  ["coverage", "Market Data Coverage", "coverage"],
  ["ai-usage", "AI Usage", "usage"],
  ["settings", "Settings", "settings"]
];

function LogoMark() {
  return (
    <svg viewBox="0 0 42 34" className="brand-logo" aria-hidden="true">
      <path d="M2 31 12 4l8 15 7-12 5 24" fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="square" />
      <path d="M31 4h9v9" fill="none" stroke="currentColor" strokeWidth="2.4" opacity=".55" />
      <path d="M6 27h30" stroke="currentColor" strokeWidth="1.2" opacity=".28" />
    </svg>
  );
}

function NavButton({ view, id, label, hint, icon, onNavigate, collapsed }) {
  const active = view === id;
  return (
    <button
      type="button"
      className={`nav-item ${active ? "is-active" : ""}`.trim()}
      aria-current={active ? "page" : undefined}
      onClick={() => onNavigate(id)}
      title={label}
    >
      <span className="nav-icon"><Icon name={icon} size={17} /></span>
      <span className="nav-copy">
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      {active && <span className="nav-active-mark" />}
    </button>
  );
}

export default function AppChrome({
  view,
  onNavigate,
  overview,
  coverage,
  coverageError,
  loading,
  onRefresh,
  children
}) {
  const [popover, setPopover] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const shellRef = useRef(null);
  const session = sessionLabel(overview?.market);
  const stats = marketCoverage(coverage);
  const verified = stats?.verifiedLatestQuote;
  const quoteEnabled = stats?.quoteEnabled;
  const freshness = coverage?.instruments?.freshness?.detail || "Coverage has not been reported.";
  const coverageKnown = Boolean(stats) && !coverageError;
  function navigate(viewId, focus) {
    setMenuOpen(false);
    setPopover(null);
    onNavigate(viewId, focus);
  }

  useEffect(() => {
    function close(event) {
      if (shellRef.current && !shellRef.current.contains(event.target)) setPopover(null);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const notifications = [];
  if (coverageError) notifications.push({ tone: "bad", title: "Coverage check failed", detail: coverageError.message || "Diagnostics are unavailable.", target: "coverage" });
  if (coverageKnown && verified === 0) notifications.push({ tone: "warn", title: "No verified market quotes", detail: "Configured providers returned no verified NSE/BSE quote. Instruments remain unavailable.", target: "coverage" });
  if (coverageKnown && quoteEnabled === 0) notifications.push({ tone: "bad", title: "No quote provider configured", detail: "The terminal runs, but prices and candles cannot be requested.", target: "settings" });
  if (!notifications.length && !coverageKnown) notifications.push({ tone: "warn", title: "Coverage pending", detail: "No current coverage snapshot is available.", target: "coverage" });
  if (!notifications.length) notifications.push({ tone: "ok", title: "Verified quotes observed", detail: "Open coverage to inspect provider and freshness details.", target: "coverage" });

  return (
    <div className="app-shell" ref={shellRef}>
      {menuOpen && <button type="button" className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? "is-open" : ""}`.trim()}>
        <button type="button" className="sidebar-brand" onClick={() => navigate("overview")} aria-label="Market Lens home">
          <span className="brand-symbol"><LogoMark /></span>
          <span className="brand-copy">
            <strong>MARKET LENS</strong>
            <small>RESEARCH · LEARN · TRADE (VIRTUAL)</small>
          </span>
        </button>

        <div className="sidebar-scroll">
          <nav className="primary-nav" aria-label="Workspaces">
            {PRIMARY_NAV.map(([id, label, hint, icon]) => (
              <NavButton key={id} view={view} id={id} label={label} hint={hint} icon={icon} onNavigate={navigate} />
            ))}
          </nav>

          <div className="nav-divider" />
          <span className="nav-section-label">ADMIN TOOLS</span>
          <nav className="admin-nav" aria-label="Administration">
            {ADMIN_NAV.map(([id, label, icon]) => (
              <NavButton key={id} view={view} id={id} label={label} icon={icon} onNavigate={navigate} />
            ))}
          </nav>
        </div>

        <div className="sidebar-promo">
          <span className="promo-orbit" aria-hidden="true"><i /><i /><i /></span>
          <strong>Learn. Analyse. Grow.</strong>
          <p>Your journey in the stock market starts here.</p>
          <button type="button" onClick={() => navigate("strategy")}>
            Explore Strategy Lab <Icon name="arrowRight" size={12} />
          </button>
        </div>

        <div className="sidebar-status">
          <i className={coverageError ? "bad" : verified > 0 ? "ok" : "warn"} />
          <span>{coverageError ? "Coverage check failed" : verified > 0 ? "Market services verified" : "Research mode · data limited"}</span>
        </div>
      </aside>

      <div className="workspace-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button type="button" className="mobile-menu" onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen}><Icon name="menu" /></button>
            <GlobalSearch
              onSelect={(instrument) => navigate("markets", { symbol: instrument.symbol, exchange: instrument.exchange, name: instrument.name, id: instrument.id })}
            />
          </div>

          <div className="topbar-right">
            <div className={`session-pill ${session.code}`} title={overview?.market?.note || "NSE session clock"}>
              <i />
              <span>{session.label}</span>
              <b>{session.time} IST</b>
            </div>
            <div className="freshness-pill" title={freshness}>
              <DataStatus
                state={{ code: verified > 0 ? "delayed" : "unavailable", label: !coverageKnown ? "COVERAGE UNKNOWN" : verified > 0 ? "QUOTES OBSERVED" : "DATA LIMITED" }}
                compact
              />
              <small>{!coverageKnown ? "Check coverage" : verified > 0 ? `${verified} observed · check freshness` : "No verified quotes"}</small>
            </div>
            <div className="popover-anchor">
              <button type="button" className="icon-btn" onClick={() => setPopover(popover === "notifications" ? null : "notifications")} aria-label="Notifications">
                <Icon name="bell" size={17} />
                <span className={`notification-dot ${notifications[0]?.tone || "ok"}`} />
              </button>
              {popover === "notifications" && (
                <div className="header-popover notification-popover">
                  <header><strong>Notifications</strong><span>{notifications.length}</span></header>
                  {notifications.map((item, index) => (
                    <button key={index} type="button" onClick={() => { navigate(item.target); }}>
                      <i className={item.tone} />
                      <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="popover-anchor">
              <button type="button" className="profile-button" onClick={() => setPopover(popover === "profile" ? null : "profile")}>
                <span className="avatar">R</span>
                <span className="profile-copy"><strong>Research Desk</strong><small>Virtual terminal</small></span>
                <Icon name="chevronDown" size={12} />
              </button>
              {popover === "profile" && (
                <div className="header-popover profile-popover">
                  <div className="profile-popover-head"><span className="avatar large">R</span><div><strong>Research Desk</strong><small>No broker connected</small></div></div>
                  <p>This account is local to this browser. Research jobs are owner-scoped; no real-money order can be placed.</p>
                  <button type="button" onClick={() => { navigate("settings"); }}>Open settings</button>
                  <button type="button" onClick={() => { navigate("coverage"); }}>Market data coverage</button>
                </div>
              )}
            </div>
            <button type="button" className={`icon-btn refresh ${loading ? "is-spinning" : ""}`.trim()} onClick={onRefresh} aria-label="Refresh market data" title="Refresh shared market data">
              <Icon name="refresh" size={16} />
            </button>
          </div>
        </header>

        <MarketTicker
          overview={overview}
          onSelect={(instrument) => navigate("markets", instrument)}
        />

        <main className="workspace-main">{children}</main>

        <footer className="terminal-statusbar">
          <div>
            <i className={coverageError ? "bad" : verified > 0 ? "ok" : "warn"} />
            <span>{coverageError ? "SYSTEMS DEGRADED" : !coverageKnown ? "COVERAGE UNKNOWN" : verified > 0 ? "RESEARCH MODE · QUOTES OBSERVED" : "RESEARCH MODE · MARKET DATA LIMITED"}</span>
          </div>
          <span>Market data: {!coverageKnown ? "coverage unknown" : verified > 0 ? "quotes observed · see individual freshness" : "unavailable"}</span>
          <span>Last updated: {overview?.generatedAt ? new Date(overview.generatedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : "—"} IST</span>
          <span className="statusbar-right">Research only · no broker execution <b>v2.0</b></span>
        </footer>
      </div>
    </div>
  );
}
