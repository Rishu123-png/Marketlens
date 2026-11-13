import { useEffect, useRef, useState } from "react";
import Icon from "./terminal/Icon.jsx";
import { api } from "../lib/api.js";
import { ASSET_LABELS, availabilityLabel } from "../lib/instruments.js";

/**
 * Search over the merged instrument master. A result states exchange, asset
 * type and quote capability. Selecting it never implies that a price exists.
 */
export default function InstrumentSearch({
  onSelect,
  placeholder = "Search symbol, company or exchange",
  autoFocus = false,
  compact = false,
  value,
  onChange
}) {
  const [query, setQuery] = useState(value || "");
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const box = useRef(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (value !== undefined && value !== query) setQuery(value);
  }, [value]);

  useEffect(() => {
    const id = ++requestRef.current;
    const clean = query.trim();
    if (clean.length < 1) {
      setResults([]);
      setTotal(0);
      setLoading(false);
      setError(null);
      return undefined;
    }
    setLoading(true);
    setResults([]);
    const timer = window.setTimeout(async () => {
      try {
        const data = await api(`/api/instruments?q=${encodeURIComponent(clean)}&limit=12`);
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
    return () => window.clearTimeout(timer);
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
    onChange?.(`${instrument.symbol} · ${instrument.exchange}`);
    setOpen(false);
    onSelect?.(instrument);
  }

  return (
    <div className={`instrument-search ${compact ? "is-compact" : ""}`.trim()} ref={box}>
      <Icon name="search" size={15} className="instrument-search-icon" />
      <input
        value={query}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label="Instrument search"
        autoComplete="off"
        onChange={(event) => {
          requestRef.current += 1;
          setResults([]);
          setQuery(event.target.value);
          onChange?.(event.target.value);
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
      {loading && <span className="search-spinner" aria-label="Searching" />}
      {open && query.trim() && (
        <ul className="instrument-results" role="listbox">
          {error && <li className="instrument-error">{error}</li>}
          {!loading && !error && !results.length && <li className="instrument-more">No catalogued match.</li>}
          {results.map((instrument) => {
            const availability = availabilityLabel(instrument);
            return (
              <li key={instrument.id}>
                <button type="button" onClick={() => choose(instrument)} role="option" aria-selected="false">
                  <span className="result-monogram">{instrument.symbol.slice(0, 2)}</span>
                  <span className="result-copy">
                    <strong>{instrument.symbol}</strong>
                    <small>{instrument.name}</small>
                  </span>
                  <span className="result-meta">
                    {instrument.exchange} · {ASSET_LABELS[instrument.assetType] || instrument.assetType}
                  </span>
                  <span className={`availability-dot ${availability.tone}`} title={availability.label} />
                </button>
              </li>
            );
          })}
          {total > results.length && (
            <li className="instrument-more">{results.length} of {total} matches · refine the query</li>
          )}
        </ul>
      )}
    </div>
  );
}
