import React, { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import AppChrome from "./components/AppChrome.jsx";
import MarketOverview from "./views/MarketOverview.jsx";
import ChartLab from "./views/ChartLab.jsx";
import StructureLab from "./views/StructureLab.jsx";
import Screener from "./views/Screener.jsx";
import NewsDesk from "./views/NewsDesk.jsx";
import ResearchLab from "./views/ResearchLab.jsx";
import Watchlists from "./views/Watchlists.jsx";
import Portfolio from "./views/Portfolio.jsx";
import Diagnostics from "./views/Diagnostics.jsx";
import "./styles.css";

const VALID_VIEWS = [
  "overview",
  "charts",
  "structure",
  "screener",
  "news",
  "research",
  "watchlists",
  "portfolio",
  "diagnostics"
];

function readView() {
  try {
    const saved = window.location.hash.replace("#", "");
    if (VALID_VIEWS.includes(saved)) return saved;
  } catch {
    /* ignore */
  }
  return "overview";
}

function App() {
  const [view, setView] = useState(readView);
  const [focus, setFocus] = useState(null);

  const navigate = useCallback(
    (next, instrument = null) => {
      if (!VALID_VIEWS.includes(next)) return;
      if (instrument) setFocus(instrument);
      setView(next);
      try {
        window.history.replaceState(null, "", `#${next}`);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch {
        /* ignore */
      }
    },
    []
  );

  const chartSeed = view === "charts" && focus?.symbol ? `${focus.symbol}:${focus.exchange || ""}` : "default";
  const structureSeed = view === "structure" && focus?.symbol ? `${focus.symbol}:${focus.exchange || ""}` : "default";

  return (
    <div className="terminal">
      <AppChrome view={view} onNavigate={navigate} />
      <main className="page-shell" id="top">
        {view === "overview" && <MarketOverview onNavigate={navigate} />}
        {view === "charts" && <ChartLab key={chartSeed} initialSymbol={focus?.symbol || "RELIANCE"} onNavigate={navigate} />}
        {view === "structure" && <StructureLab key={structureSeed} initialInstrument={focus} />}
        {view === "screener" && <Screener onNavigate={navigate} />}
        {view === "news" && <NewsDesk />}
        {view === "research" && <ResearchLab />}
        {view === "watchlists" && <Watchlists onNavigate={navigate} />}
        {view === "portfolio" && <Portfolio onNavigate={navigate} />}
        {view === "diagnostics" && <Diagnostics />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
