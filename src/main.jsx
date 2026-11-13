import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import AppChrome from "./components/AppChrome.jsx";
import Overview from "./views/Overview.jsx";
import { api } from "./lib/api.js";
import { usePersistentState } from "./lib/usePersistentState.js";
import "./styles.css";

const Markets = React.lazy(() => import("./views/Markets.jsx"));
const Screener = React.lazy(() => import("./views/Screener.jsx"));
const News = React.lazy(() => import("./views/News.jsx"));
const Research = React.lazy(() => import("./views/Research.jsx"));
const StrategyLab = React.lazy(() => import("./views/StrategyLab.jsx"));
const VirtualTrading = React.lazy(() => import("./views/VirtualTrading.jsx"));
const Watchlist = React.lazy(() => import("./views/Watchlist.jsx"));
const Diagnostics = React.lazy(() => import("./views/Diagnostics.jsx"));
const Coverage = React.lazy(() => import("./views/Coverage.jsx"));
const AIUsage = React.lazy(() => import("./views/AIUsage.jsx"));
const Settings = React.lazy(() => import("./views/Settings.jsx"));

const VIEWS = ["overview", "markets", "screener", "news", "research", "strategy", "trading", "watchlist", "diagnostics", "coverage", "ai-usage", "settings"];
const ALIASES = { home: "overview", charts: "markets", structure: "markets", portfolio: "trading", watchlists: "watchlist" };
const DEFAULT_SETTINGS = {
  density: "compact",
  reduceMotion: false,
  emphasiseUnavailable: true,
  refreshSeconds: 180,
  defaultExchange: "NSE",
  defaultDepth: "standard"
};

function canonicalView(value) {
  const clean = String(value || "")
    .replace(/^#\/?/, "")
    .replace(/^\//, "")
    .split("?")[0]
    .trim();
  return ALIASES[clean] || clean;
}

function readLocation() {
  try {
    const view = canonicalView(window.location.hash);
    return {
      view: VIEWS.includes(view) ? view : "overview",
      focus: window.history.state?.focus || null
    };
  } catch {
    return { view: "overview", focus: null };
  }
}

function App() {
  const [route, setRoute] = useState(readLocation);
  const [settings, setSettings] = usePersistentState("marketlens-preferences-v2", DEFAULT_SETTINGS);
  const [overview, setOverview] = useState(null);
  const [overviewError, setOverviewError] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [coverageError, setCoverageError] = useState(null);
  const [loading, setLoading] = useState(false);

  const refreshShared = useCallback(async () => {
    setLoading(true);
    const [overviewResult, coverageResult] = await Promise.allSettled([
      api("/api/market-overview"),
      api("/api/coverage")
    ]);
    if (overviewResult.status === "fulfilled") {
      setOverview(overviewResult.value);
      setOverviewError(null);
    } else {
      setOverview(null);
      setOverviewError(overviewResult.reason);
    }
    if (coverageResult.status === "fulfilled" && coverageResult.value?.ok !== false) {
      setCoverage(coverageResult.value);
      setCoverageError(null);
    } else {
      setCoverage(null);
      setCoverageError(coverageResult.status === "rejected" ? coverageResult.reason : new Error(coverageResult.value?.error || "Coverage unavailable."));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refreshShared();
    const timer = window.setInterval(refreshShared, Math.max(60, Number(settings.refreshSeconds) || 180) * 1000);
    return () => window.clearInterval(timer);
  }, [refreshShared, settings.refreshSeconds]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.density = settings.density || "compact";
    root.dataset.motion = settings.reduceMotion ? "reduced" : "full";
    root.dataset.unavailable = settings.emphasiseUnavailable ? "emphasised" : "quiet";
  }, [settings.density, settings.reduceMotion, settings.emphasiseUnavailable]);

  useEffect(() => {
    function onPop() {
      setRoute(readLocation());
    }
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("hashchange", onPop);
    };
  }, []);

  const navigate = useCallback((next, focus = null) => {
    const view = canonicalView(next);
    if (!VIEWS.includes(view)) return;
    setRoute({ view, focus });
    try {
      window.history.pushState({ view, focus }, "", `#${view}`);
      window.scrollTo({ top: 0, behavior: "auto" });
    } catch {
      /* history can be unavailable in restricted frames */
    }
  }, []);

  const preferences = { ...DEFAULT_SETTINGS, ...settings };
  const common = { overview, overviewError, coverage, onNavigate: navigate, loading, defaultExchange: preferences.defaultExchange };
  const chartFocus = route.focus?.symbol ? route.focus : null;

  return (
    <AppChrome
      view={route.view}
      onNavigate={navigate}
      overview={overview}
      coverage={coverage}
      coverageError={coverageError}
      loading={loading}
      reduceMotion={preferences.reduceMotion}
      onRefresh={refreshShared}
    >
      <React.Suspense fallback={<section className="workspace"><div className="workspace-loading" role="status">Loading workspace…</div></section>}>
      {route.view === "overview" && <Overview {...common} onRefresh={refreshShared} />}
      {route.view === "markets" && <Markets key={chartFocus ? `${chartFocus.symbol}:${chartFocus.exchange || ""}` : "markets-default"} focus={chartFocus} defaultExchange={preferences.defaultExchange} onNavigate={navigate} />}
      {route.view === "screener" && <Screener key={route.focus?.filters ? JSON.stringify(route.focus.filters) : "screener-default"} focus={route.focus} onNavigate={navigate} />}
      {route.view === "news" && <News focus={route.focus} defaultExchange={preferences.defaultExchange} onNavigate={navigate} />}
      {route.view === "research" && <Research key={route.focus?.symbol ? `${route.focus.symbol}:${route.focus.exchange || ""}` : "research-default"} focus={route.focus} defaultExchange={preferences.defaultExchange} defaultDepth={preferences.defaultDepth} onNavigate={navigate} />}
      {route.view === "strategy" && <StrategyLab defaultExchange={preferences.defaultExchange} onNavigate={navigate} />}
      {route.view === "trading" && <VirtualTrading onNavigate={navigate} />}
      {route.view === "watchlist" && <Watchlist onNavigate={navigate} />}
      {route.view === "diagnostics" && <Diagnostics onNavigate={navigate} />}
      {route.view === "coverage" && <Coverage />}
      {route.view === "ai-usage" && <AIUsage />}
      {route.view === "settings" && <Settings settings={{ ...DEFAULT_SETTINGS, ...settings }} onSettingsChange={setSettings} onNavigate={navigate} />}
      </React.Suspense>
    </AppChrome>
  );
}

createRoot(document.getElementById("root")).render(<App />);
