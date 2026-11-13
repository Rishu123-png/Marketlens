import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/terminal/Icon.jsx";
import TerminalPanel from "../components/terminal/TerminalPanel.jsx";
import InstrumentSearch from "../components/InstrumentSearch.jsx";
import EmptyState from "../components/terminal/EmptyState.jsx";
import EvidenceBadge from "../components/terminal/EvidenceBadge.jsx";
import DataStatus from "../components/terminal/DataStatus.jsx";
import { api, formatTime } from "../lib/api.js";
import { defaultInstrument } from "../lib/instruments.js";

const TYPE_LABELS = { news: "News", filing: "Filing", announcement: "Announcement", regulatory: "Regulatory" };
const FILTERS = [["all", "All"], ["news", "News"], ["filing", "Filings"], ["announcement", "Announcements"], ["regulatory", "Regulatory"]];

export default function News({ onNavigate, focus, defaultExchange = "NSE" }) {
  const [instrument, setInstrument] = useState(() => focus?.symbol ? focus : defaultInstrument(defaultExchange));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [coverage, setCoverage] = useState(null);
  const [coverageUnavailable, setCoverageUnavailable] = useState(false);
  const requestRef = useRef(0);
  const abortRef = useRef(null);

  const load = useCallback(async (target = instrument) => {
    const id = ++requestRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setData(null);
    setError(null);
    try {
      const payload = await api(`/api/news?symbol=${encodeURIComponent(target.symbol)}&exchange=${encodeURIComponent(target.exchange || "")}&limit=40&filings=true`, { signal: controller.signal });
      if (requestRef.current === id) setData(payload);
    } catch (cause) {
      if (requestRef.current === id) setError(cause.message);
    } finally {
      if (requestRef.current === id) setLoading(false);
    }
  }, [instrument]);

  useEffect(() => {
    load(instrument);
    let active = true;
    api("/api/coverage").then((payload) => { if (active) { setCoverage(payload.coverage); setCoverageUnavailable(!payload.coverage); } }).catch(() => { if (active) { setCoverage(null); setCoverageUnavailable(true); } });
    return () => { active = false; requestRef.current += 1; abortRef.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = useMemo(() => {
    const list = [...(data?.evidence || [])].sort((a, b) => (Date.parse(b.publishedAt || b.retrievedAt) || 0) - (Date.parse(a.publishedAt || a.retrievedAt) || 0));
    return filter === "all" ? list : list.filter((item) => item.sourceType === filter);
  }, [data, filter]);

  const counts = useMemo(() => {
    const map = {};
    for (const item of data?.evidence || []) map[item.sourceType] = (map[item.sourceType] || 0) + 1;
    return map;
  }, [data]);

  function choose(next) {
    setInstrument(next);
    load(next);
  }

  return (
    <section className="workspace news-workspace">
      <header className="workspace-head">
        <div>
          <span className="workspace-kicker">NEWS &amp; EVENTS · UNTRUSTED EVIDENCE</span>
          <h1>News &amp; Events</h1>
          <p>Headlines are evidence, not confirmation. Every item keeps publisher, URL, publication time and retrieval time.</p>
        </div>
        <div className="workspace-head-actions">
          <span className="head-date">{data?.counts?.returned ?? "—"} returned · {data?.counts?.rejected ?? "—"} rejected</span>
          <button type="button" className="t-btn secondary sm" onClick={() => load()} disabled={loading}><Icon name="refresh" size={13} className={loading ? "spin" : ""} /> Refresh evidence</button>
        </div>
      </header>

      <div className="news-toolbar">
        <div className="news-toolbar-search"><InstrumentSearch compact onSelect={choose} placeholder="Company or index…" /></div>
        <div className="news-exchange">
          <span>MARKET</span>
          <select value={instrument.exchange} onChange={(event) => choose({ symbol: instrument.symbol, name: instrument.symbol, exchange: event.target.value })}>
            {["NSE", "BSE", "NASDAQ", "NYSE"].map((exchange) => <option key={exchange}>{exchange}</option>)}
          </select>
        </div>
        <div className="news-filter-tabs">
          {FILTERS.map(([value, label]) => (
            <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
              {label}{counts[value] ? <span>{counts[value]}</span> : null}
            </button>
          ))}
        </div>
        <div className="event-coverage-inline">
          {["news", "filings", "macro"].map((key) => (
            <span key={key} className={`coverage-dot ${coverage?.capabilities?.[key]?.status || "unknown"}`}>
              <i /> {coverage?.capabilities?.[key]?.label || key}: {coverage?.capabilities?.[key]?.status || (coverageUnavailable ? "unknown" : "checking")}
            </span>
          ))}
          <span className="coverage-dot unavailable"><i /> Earnings calendar: not configured</span>
        </div>
      </div>

      {error && <div className="inline-alert error" role="alert"><Icon name="warn" size={15} /><div><strong>Evidence unavailable</strong><span>{error}</span></div></div>}

      <div className="news-grid">
        <TerminalPanel
          kicker={`${instrument.symbol} · ${instrument.exchange}`}
          title={`${instrument.name} · timeline`}
          actions={<span className="panel-chip">{data ? items.length : "—"} displayed</span>}
          className="news-timeline-panel"
        >
          {loading && <div className="panel-loading"><span className="loader-ring" /> Loading sourced evidence…</div>}
          {!loading && !items.length && (
            <EmptyState
              icon="news"
              title="No matching evidence returned"
              detail={data ? "The configured RSS and filing sources returned no items for this filter. This is a coverage limitation, not “no news exists”." : "Evidence has not loaded."}
              action={<button type="button" className="t-btn secondary sm" onClick={() => setFilter("all")}>Show all types</button>}
            />
          )}
          <div className="news-timeline">
            {!loading && items.map((item, index) => (
              <article key={item.id || index} className="timeline-item">
                <div className="timeline-rail"><i /><span /></div>
                <div className="timeline-card">
                  <header>
                    <span className="news-source-mark">{item.publisher?.slice(0, 2)?.toUpperCase() || "NW"}</span>
                    <div className="timeline-meta">
                      <span className="news-type-tag">{TYPE_LABELS[item.sourceType] || item.sourceType}</span>
                      <strong>{item.publisher}</strong>
                      <span>Published {item.publishedAt ? formatTime(item.publishedAt) : "time unavailable"}</span>
                    </div>
                    <div className="timeline-badges">
                      {item.verification && <EvidenceBadge tone="unverified">{item.verification}</EvidenceBadge>}
                      {item.metadata?.injectionSignals?.length > 0 && <EvidenceBadge tone="unavailable">Flagged text</EvidenceBadge>}
                    </div>
                  </header>
                  <h3>{item.metadata?.title || item.excerpt?.slice(0, 128) || "Untitled evidence"}</h3>
                  {item.excerpt && <p>{item.excerpt}</p>}
                  <footer>
                    {item.url ? <a href={item.url} target="_blank" rel="noreferrer noopener">Open source <Icon name="external" size={11} /></a> : <span className="muted">No source URL supplied</span>}
                    <span>Retrieved {formatTime(item.retrievedAt)}</span>
                    {item.duplicateCount > 1 && <span>{item.duplicateCount} syndicated copies</span>}
                  </footer>
                </div>
              </article>
            ))}
          </div>
        </TerminalPanel>

        <aside className="news-side">
          <TerminalPanel kicker="SOURCE HEALTH" title="Evidence providers" className="source-health-panel">
            {data?.sources?.length ? (
              <ul className="source-list">
                {data.sources.map((source) => (
                  <li key={source.id}>
                    <div><strong>{source.id}</strong><small>{source.items ?? 0} items{source.reason ? ` · ${source.reason}` : ""}</small></div>
                    <DataStatus state={{ code: source.status === "ok" ? "delayed" : source.status === "failed" ? "unavailable" : "unavailable", label: source.status || "UNKNOWN" }} compact />
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact icon="globe" title="No source report" detail="Run a news request to inspect source health." />}
            <p className="provenance-note"><Icon name="shield" size={11} /> Retrieved text is sanitised and treated as data, never as instructions.</p>
          </TerminalPanel>

          <TerminalPanel kicker="EVENT COVERAGE" title="What is configured" className="event-panel">
            <div className="kv-list">
              <div><span>Company news</span><strong>{coverage?.capabilities?.news?.status || "unknown"}</strong></div>
              <div><span>Official filings</span><strong>{coverage?.capabilities?.filings?.status || "unknown"}</strong></div>
              <div><span>Macro headlines</span><strong>{coverage?.capabilities?.macro?.status || "unknown"}</strong></div>
              <div><span>Earnings calendar</span><strong className="value-down">not configured</strong></div>
              <div><span>Source timestamps</span><strong>preserved</strong></div>
            </div>
            <p className="provenance-note">No earnings dates are inferred from headlines. No paywalled scraping source is used.</p>
          </TerminalPanel>

          <TerminalPanel kicker="NEXT STEP" title="Use evidence in research" className="news-research-panel">
            <p className="panel-paragraph">Send this instrument to the AI Analyst. The report cites evidence IDs and publishes only after the deterministic gate.</p>
            <button type="button" className="t-btn primary full" onClick={() => onNavigate?.("research", instrument)}><Icon name="ai" size={12} /> Open AI Analyst</button>
          </TerminalPanel>
        </aside>
      </div>
    </section>
  );
}
