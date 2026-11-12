import { useCallback, useEffect, useMemo, useState } from "react";
import InstrumentSearch from "../components/InstrumentSearch.jsx";
import { api, formatTime } from "../lib/api.js";

const TYPE_LABELS = {
  news: "News",
  filing: "Filing",
  announcement: "Announcement",
  macro: "Macro"
};

export default function NewsDesk() {
  const [instrument, setInstrument] = useState({ symbol: "RELIANCE", exchange: "NSE", name: "Reliance Industries Ltd" });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [coverage, setCoverage] = useState(null);

  const load = useCallback(async (target = instrument) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await api(
        `/api/news?symbol=${encodeURIComponent(target.symbol)}` +
          `&exchange=${encodeURIComponent(target.exchange || "")}&limit=40&filings=true`
      );
      setData(payload);
    } catch (cause) {
      setData(null);
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  }, [instrument]);

  useEffect(() => {
    load(instrument);
    api("/api/coverage")
      .then((payload) => setCoverage(payload.coverage))
      .catch(() => setCoverage(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = useMemo(() => {
    const list = data?.evidence || [];
    return filter === "all" ? list : list.filter((item) => item.sourceType === filter);
  }, [data, filter]);

  const types = useMemo(() => {
    const counts = {};
    for (const item of data?.evidence || []) counts[item.sourceType] = (counts[item.sourceType] || 0) + 1;
    return counts;
  }, [data]);

  return (
    <section className="lab">
      <header className="lab-heading">
        <div>
          <span className="eyebrow">NEWS &amp; EVENTS</span>
          <h1>
            Headlines are evidence, <span>not confirmation.</span>
          </h1>
          <p>
            Company news, official filings and macro headlines relevant to one instrument. Every item keeps its
            publisher, URL, publication time and retrieval time; syndicated copies are deduplicated, not counted as
            independent confirmation.
          </p>
        </div>
        <div className="heading-side">
          <span className="chip muted">untrusted text</span>
          <span className="chip">{data?.evidence?.length ?? 0} items</span>
        </div>
      </header>

      <div className="event-coverage-strip">
        <span className="section-kicker">EVENT COVERAGE</span>
        {["news", "filings", "macro"].map((key) => (
          <span key={key} className={`coverage-pill ${coverage?.capabilities?.[key]?.status || "unknown"}`}>
            {coverage?.capabilities?.[key]?.label || key}: {coverage?.capabilities?.[key]?.status || "checking"}
          </span>
        ))}
        <span className="coverage-pill unavailable" title="No configured provider supplies an earnings calendar. The platform does not infer earnings dates from headlines.">
          Earnings calendar: not configured
        </span>
      </div>

      <div className="terminal-toolbar">
        <div className="toolbar-search">
          <InstrumentSearch
            onSelect={(next) => {
              setInstrument(next);
              load(next);
            }}
          />
        </div>
        <div className="timeframe-row">
          {[["all", "All"], ["news", "News"], ["filing", "Filings"], ["announcement", "Announcements"], ["macro", "Macro"]].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filter === value ? "timeframe active" : "timeframe"}
              onClick={() => setFilter(value)}
            >
              {label}{types[value] ? ` ${types[value]}` : ""}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="notice error" role="alert">
          <strong>Evidence is unavailable</strong>
          <p>{error}</p>
        </div>
      )}

      <div className="lab-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="section-kicker">{instrument.symbol} · {instrument.exchange}</span>
              <h2>{instrument.name} · news &amp; events</h2>
            </div>
            {data && <span className="chip">{data.counts?.returned ?? 0} returned · {data.counts?.rejected ?? 0} rejected</span>}
          </div>

          {loading && <div className="chart-placeholder loading">Loading evidence…</div>}
          {!loading && !items.length && (
            <div className="chart-placeholder empty">
              No news or filings were returned by the configured sources. This is a coverage limitation, not “no news
              exists”.
            </div>
          )}
          <ul className="news-list">
            {items.map((item) => (
              <li key={item.id} className="news-item">
                <div className="news-head">
                  <span className="evidence-type">{TYPE_LABELS[item.sourceType] || item.sourceType}</span>
                  <span className="news-publisher">{item.publisher}</span>
                  <span className="news-time">{formatTime(item.publishedAt || item.retrievedAt)}</span>
                  {item.verification && <span className="chip muted">{item.verification}</span>}
                </div>
                <h3>{item.metadata?.title || item.excerpt?.slice(0, 120) || "Untitled item"}</h3>
                {item.excerpt && <p>{item.excerpt}</p>}
                <div className="news-foot">
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer noopener">Open source ↗</a>
                  ) : (
                    <span className="not-quoted">No source URL supplied</span>
                  )}
                  <small>Retrieved {formatTime(item.retrievedAt)}</small>
                </div>
              </li>
            ))}
          </ul>
        </article>

        <aside className="lab-side">
          <article className="panel">
            <div className="panel-head compact">
              <h2>Source status</h2>
            </div>
            <ul className="source-list">
              {(data?.sources || []).map((source) => (
                <li key={source.id}>
                  <strong>{source.id}</strong>
                  <span className={`availability-pill ${source.status === "ok" ? "ok" : source.status === "failed" ? "bad" : "muted"}`}>
                    {source.status}
                  </span>
                  <small>{source.items ?? 0} items{source.reason ? ` · ${source.reason}` : ""}</small>
                </li>
              ))}
              {!data?.sources?.length && <li className="muted-note">No sources reported yet.</li>}
            </ul>
            <p className="muted-note">
              GNews/NewsAPI keys are optional. Official RSS and SEC EDGAR are used when configured; paywalled or
              scraping-only sources are excluded.
            </p>
          </article>

          <article className="panel">
            <div className="panel-head compact">
              <h2>Limitations</h2>
            </div>
            <ul className="limitation-list">
              {(data?.limitations || []).map((line, index) => <li key={index}>{line}</li>)}
            </ul>
          </article>
        </aside>
      </div>
    </section>
  );
}
