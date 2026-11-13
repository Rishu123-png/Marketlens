import { useEffect, useRef, useState } from "react";
import Icon from "./terminal/Icon.jsx";
import { api } from "../lib/api.js";
import { ASSET_LABELS } from "../lib/instruments.js";

export default function GlobalSearch({ onSelect }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const boxRef = useRef(null);
  const timerRef = useRef(null);
  const requestRef = useRef(0);

  useEffect(() => {
    function onKey(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    }
    function onClick(event) {
      if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, []);

  useEffect(() => {
    const id = ++requestRef.current;
    const clean = query.trim();
    window.clearTimeout(timerRef.current);
    if (!clean) {
      setResults([]);
      setLoading(false);
      setError(null);
      return undefined;
    }
    setLoading(true);
    setResults([]);
    timerRef.current = window.setTimeout(async () => {
      try {
        const data = await api(`/api/instruments?q=${encodeURIComponent(clean)}&limit=8`);
        if (requestRef.current === id) { setResults(data.instruments || []); setError(null); }
      } catch (cause) {
        if (requestRef.current === id) { setResults([]); setError(cause.message || "Search unavailable."); }
      } finally {
        if (requestRef.current === id) setLoading(false);
      }
    }, 180);
    return () => window.clearTimeout(timerRef.current);
  }, [query]);

  function choose(instrument) {
    setOpen(false);
    setQuery("");
    onSelect?.(instrument);
  }

  return (
    <div className="global-search" ref={boxRef}>
      <Icon name="search" size={16} className="global-search-icon" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          requestRef.current += 1;
          setResults([]);
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && results[0]) {
            event.preventDefault();
            choose(results[0]);
          }
        }}
        placeholder="Search for a stock, index or company…  (e.g. TCS, NIFTY 50)"
        aria-label="Global instrument search"
        autoComplete="off"
      />
      <kbd>Ctrl + K</kbd>
      {loading && <span className="global-search-spinner" />}
      {open && query.trim() && (
        <div className="global-results">
          <div className="global-results-label">Instruments · selection never implies a live quote</div>
          {results.map((instrument) => (
            <button key={instrument.id} type="button" onClick={() => choose(instrument)}>
              <span className="result-monogram">{instrument.symbol.slice(0, 2)}</span>
              <span className="result-copy">
                <strong>{instrument.symbol}</strong>
                <small>{instrument.name}</small>
              </span>
              <span className="result-meta">
                {instrument.exchange} · {ASSET_LABELS[instrument.assetType] || instrument.assetType}
              </span>
              <Icon name="arrowRight" size={13} />
            </button>
          ))}
          {!loading && !results.length && <div className="global-results-empty">{error || "No catalogued instrument matched that query."}</div>}
        </div>
      )}
    </div>
  );
}
