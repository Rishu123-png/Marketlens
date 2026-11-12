import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import AppChrome from "./components/AppChrome.jsx";
import MarketOverview from "./views/MarketOverview.jsx";
import ChartLab from "./views/ChartLab.jsx";
import ResearchLab from "./views/ResearchLab.jsx";
import "./styles.css";

const VIEW_STORAGE_KEY = "marketlens-view";
const VALID_VIEWS = ["overview", "charts", "research"];

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

  function navigate(next) {
    if (!VALID_VIEWS.includes(next) || next === view) return;
    setView(next);
    try {
      window.history.replaceState(null, "", `#${next}`);
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="terminal">
      <AppChrome view={view} onNavigate={navigate} />
      <main className="page-shell" id="top">
        {view === "overview" && <MarketOverview />}
        {view === "charts" && <ChartLab />}
        {view === "research" && <ResearchLab />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
