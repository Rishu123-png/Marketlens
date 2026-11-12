import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { ASSET_LABELS, availabilityLabel } from "../lib/instruments.js";

/**
 * Search over the merged instrument master. Results state exchange, asset type
 * and whether any configured provider can quote the instrument; selection is
 * explicit so a search result is never mistaken for a live quote.
 */
export default function InstrumentSearch({ onSelect, placeholder = "Search symbol, company, exchange or asset type", autoFocus = false, compact = false }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const box = useRef(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const value = query.trim();
    if (value.length < 1) {
      setResults([]);
      setTotal(0);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const id = ++requestRef.current;
    const timer = setTimeout(async () => {
      try {
        const data = await api(`/api/instruments?q=${encodeURIComponent(value)}&limit=12`);
        if (requestRef.current !== id) return;
        setResults(data.instruments || []);
        setTotal(Number(data.total) || 0);
        setError(null);
      } catch (cause) {
        if (requestRef.current === id) setError(cause.message || "Search unavailable.");
      } finally {
        if (requestRef.current === id) setLoading(false);
      }
    }, 220);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function close(event) {
      if (box.current && !box.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function choose(instrument) {
    setQuery(`${instrument.symbol} · ${instrument.exchange}`);
    setOpen(false);
    onSelect?.(instrument);
  }

  return (
    <div className={`instrument-picker${compact ? " compact" : ""}`} ref={box}>
      <input
        value={query}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label="Instrument search"
        autoComplete="off"
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && results[0]) {
            event.preventDefault();
            choose(results[0]);
          }
          if (event.key === "Escape") setOpen(false);
        }}
      />
      {loading && <span className="picker-state">searching…</span>}
      {open && (results.length > 0 || error) && (
        <ul className="picker-results" role="listbox">
          {error && <li className="picker-error">{error}</li>}
          {results.map((instrument) => {
            const availability = availabilityLabel(instrument);
            return (
              <li key={instrument.id}>
                <button type="button" onClick={() => choose(instrument)} role="option" aria-selected="false">
                  <span className="picker-symbol">{instrument.symbol}</span>
                  <span className="picker-name">{instrument.name}</span>
                  <span className="picker-meta">
                    {instrument.exchange} · {ASSET_LABELS[instrument.assetType] || instrument.assetType}
                  </span>
                  <span className={`availability-dot ${availability.tone}`} title={availability.label} />
                </button>
              </li>
            );
          })}
          {total > results.length && (
            <li className="picker-more">
              Showing {results.length} of {total} matches — refine the query or use the instrument explorer.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
