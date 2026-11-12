import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

const LABELS = {
  quotes: "Quotes",
  candles: "Candles",
  news: "News",
  filings: "Filings",
  nav: "NAV",
  macro: "Macro"
};

function chipTitle(capability) {
  return [
    capability.reason,
    capability.note,
    capability.delayed ? "Delayed by design." : null,
    capability.liveVerification === "unverified" ? "Live reachability not verified in this environment." : null
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Evidence coverage strip. It reads /api/coverage so the user can see which
 * capabilities are actually available — and, just as importantly, which are not.
 */
export default function CoverageBar({ compact = false }) {
  const [coverage, setCoverage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api("/api/coverage")
      .then((payload) => {
        if (alive) setCoverage(payload?.coverage ?? null);
      })
      .catch((cause) => {
        if (alive) setError(cause.message || "Coverage unavailable.");
      });
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <div className="coverage-bar degraded">
        <span className="coverage-title">EVIDENCE COVERAGE</span>
        <span className="coverage-note">Unavailable: {error}</span>
      </div>
    );
  }

  if (!coverage) {
    return (
      <div className="coverage-bar">
        <span className="coverage-title">EVIDENCE COVERAGE</span>
        <span className="coverage-note">Checking sources…</span>
      </div>
    );
  }

  return (
    <div className={`coverage-bar ${coverage.degraded ? "degraded" : "full"}${compact ? " compact" : ""}`}>
      <span className="coverage-title">EVIDENCE COVERAGE</span>
      <ul className="coverage-chips">
        {Object.entries(coverage.capabilities ?? {}).map(([id, capability]) => (
          <li key={id} className={`coverage-chip ${capability.status}`} title={chipTitle(capability)}>
            {LABELS[id] ?? id}
            <span>{capability.status}</span>
          </li>
        ))}
      </ul>
      {!compact && coverage.summary ? <span className="coverage-note">{coverage.summary}</span> : null}
    </div>
  );
}
