import { useCallback, useEffect, useMemo, useState } from "react";
import InstrumentSearch from "../components/InstrumentSearch.jsx";
import CoverageBar from "../components/CoverageBar.jsx";
import { api, formatMoney, formatPercent, formatTime } from "../lib/api.js";
import { ASSET_LABELS, availabilityLabel } from "../lib/instruments.js";
import { usePersistentState } from "../lib/usePersistentState.js";

const TABS = [
  ["movers", "Movers"],
  ["heatmap", "Heatmap"],
  ["sectors", "Sectors"],
  ["instruments", "Instrument master"]
];

function compactVolume(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value));
}

function asInstrument(entry) {
  return {
    id: entry.id,
    symbol: entry.symbol,
    name: entry.name,
    exchange: entry.exchange,
    currency: entry.quote?.currency || entry.currency || "INR",
    assetType: entry.assetType
  };
}

function IndexCard({ entry }) {
  const quote = entry.quote;
  const change = Number(quote?.changePercent);
  return (
    <article className="summary-card index-card">
      <div className="summary-label">
        <span>{entry.name}</span>
        <span>{entry.exchange}</span>
      </div>
      <strong>{quote ? formatMoney(quote.price, quote.currency) : "—"}</strong>
      <div className="index-meta">
        {quote ? (
          <>
            <span className={change >= 0 ? "positive-text" : "negative-text"}>{formatPercent(quote.changePercent)}</span>
            <small>{quote.source}</small>
          </>
        ) : (
          <small className="not-quoted">no verified quote</small>
        )}
      </div>
    </article>
  );
}

export default function MarketOverview({ onNavigate }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("movers");
  const [watchlist, setWatchlist] = usePersistentState("marketlens-watchlist-v2", []);
  const [watchQuotes, setWatchQuotes] = useState({});
  const [watchError, setWatchError] = useState(null);
  const [instruments, setInstruments] = useState(null);
  const [instrumentQuery, setInstrumentQuery] = useState("");
  const [instrumentType, setInstrumentType] = useState("");
  const [instrumentExchange, setInstrumentExchange] = useState("");
  const [page, setPage] = useState(0);
  const [instrumentLoading, setInstrumentLoading] = useState(false);
  const pageSize = 25;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await api("/api/market-overview"));
    } catch (cause) {
      setError(cause.message || "Market overview is unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 3 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!watchlist.length) {
      setWatchQuotes({});
      return;
    }
    let cancelled = false;
    const symbols = watchlist
      .slice(0, 24)
      .map((entry) => `${entry.symbol}@${entry.exchange || "NSE"}`);
    api(`/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`)
      .then((data) => {
        if (cancelled) return;
        setWatchQuotes(
          Object.fromEntries(
            (data.quotes || []).map((entry) => [
              `${entry.symbol}|${entry.quote?.exchange || entry.exchange || "NSE"}`,
              entry.quote
            ])
          )
        );
        setWatchError((data.failures || []).length ? `${data.failures.length} watchlist instrument(s) have no verified quote.` : null);
      })
      .catch((cause) => {
        if (!cancelled) setWatchError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, [watchlist]);

  useEffect(() => {
    if (tab !== "instruments") return undefined;
    let cancelled = false;
    setInstrumentLoading(true);
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String(page * pageSize)
    });
    if (instrumentQuery.trim()) params.set("q", instrumentQuery.trim());
    if (instrumentType) params.set("assetType", instrumentType);
    if (instrumentExchange) params.set("exchange", instrumentExchange);

    const timer = setTimeout(() => {
      api(`/api/instruments?${params.toString()}`)
        .then((data) => {
          if (!cancelled) setInstruments(data);
        })
        .catch((cause) => {
          if (!cancelled) setInstruments({ error: cause.message, instruments: [], total: 0 });
        })
        .finally(() => {
          if (!cancelled) setInstrumentLoading(false);
        });
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tab, instrumentQuery, instrumentType, instrumentExchange, page]);

  useEffect(() => {
    setPage(0);
  }, [instrumentQuery, instrumentType, instrumentExchange]);

  const watchKeys = useMemo(() => new Set(watchlist.map((entry) => entry.id || `${entry.symbol}:${entry.exchange}`)), [watchlist]);

  function toggleWatch(entry) {
    const key = entry.id || `${entry.symbol}:${entry.exchange}`;
    setWatchlist((current) => {
      const exists = current.some((item) => (item.id || `${item.symbol}:${item.exchange}`) === key);
      if (exists) return current.filter((item) => (item.id || `${item.symbol}:${item.exchange}`) !== key);
      return [
        ...current,
        {
          id: entry.id || key,
          symbol: entry.symbol,
          name: entry.name,
          exchange: entry.exchange,
          currency: entry.currency || entry.quote?.currency || "INR"
        }
      ];
    });
  }

  const coverage = overview?.coverage;
  const coverageTone =
    coverage?.status === "full-coverage"
      ? "ok"
      : coverage?.status === "partial-coverage"
        ? "warn"
        : coverage?.status === "low-coverage"
          ? "bad"
          : "muted";

  return (
    <section className="view">
      <header className="page-heading">
        <div>
          <span className="eyebrow">MARKET OVERVIEW · INDIA FIRST <span className="eyebrow-date">{overview?.market?.label || ""}</span></span>
          <h1>
            The market, <span>stated with its coverage.</span>
          </h1>
          <p>
            Index cards, breadth and movers are derived only from provider-verified quotes. Unverified instruments stay
            unverified — no sample prices, no carried-forward fills.
          </p>
        </div>
        <div className="heading-actions">
          <span className="last-updated">{overview ? `AS OF ${formatTime(overview.generatedAt)}` : "LOADING"}</span>
          <button className="refresh-button" type="button" onClick={refresh} disabled={loading}>
            <span className={`refresh-icon ${loading ? "spinning" : ""}`}>↻</span>
            {loading ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </header>

      {error && (
        <div className="notice error" role="alert">
          <strong>Market overview is unavailable</strong>
          <p>{error}</p>
        </div>
      )}

      <div className="summary-grid">
        {(overview?.indices || [
          { name: "Nifty 50", symbol: "^NSEI", exchange: "NSE" },
          { name: "Nifty Bank", symbol: "^NSEBANK", exchange: "NSE" },
          { name: "Nifty IT", symbol: "^CNXIT", exchange: "NSE" },
          { name: "BSE Sensex", symbol: "^BSESN", exchange: "BSE" }
        ]).map((entry) => (
          <IndexCard key={entry.symbol} entry={entry} />
        ))}
      </div>

      <div className="breadth-strip">
        <div className="breadth-counts">
          <span className="breadth-label">VERIFIED BREADTH</span>
          <strong className="positive-text">{overview?.breadth?.advancers ?? "—"}</strong>
          <span className="breadth-sep">advanced</span>
          <strong className="negative-text">{overview?.breadth?.decliners ?? "—"}</strong>
          <span className="breadth-sep">declined</span>
          <strong>{overview?.breadth?.unchanged ?? "—"}</strong>
          <span className="breadth-sep">unchanged</span>
        </div>
        <div className="breadth-bar" aria-hidden="true">
          <i
            className="advance"
            style={{ width: `${overview?.breadth?.advancePercent ?? 0}%` }}
          />
        </div>
        <div className={`coverage-badge ${coverageTone}`}>
          <strong>
            {coverage?.verified ?? 0}/{coverage?.attempted ?? 0}
          </strong>
          <span>verified quotes</span>
        </div>
      </div>
      <p className="breadth-note">
        {overview?.breadth?.note ||
          "Breadth is calculated over instruments with verified quotes in the attempted universe, not the whole exchange."}
        {overview?.coverage?.freshness?.detail ? ` ${overview.coverage.freshness.detail}` : ""}
      </p>

      <CoverageBar compact />

      <div className="market-layout">
        <article className="market-panel instruments-panel">
          <div className="panel-toolbar">
            <div>
              <span className="section-kicker">QUOTES &amp; UNIVERSE</span>
              <h2>
                {tab === "instruments" ? "Instrument master" : "Market detail"}
                <span className="stock-count">{tab === "instruments" ? instruments?.total ?? "—" : overview?.breadth?.verified ?? 0}</span>
              </h2>
            </div>
            {tab === "instruments" && (
              <div className="instrument-search">
                <span className="search-icon">⌕</span>
                <input
                  value={instrumentQuery}
                  onChange={(event) => setInstrumentQuery(event.target.value)}
                  placeholder="Symbol, company, exchange or asset type"
                  aria-label="Search instrument master"
                />
                {instrumentQuery && (
                  <button type="button" className="clear-search" onClick={() => setInstrumentQuery("")} aria-label="Clear search">
                    ×
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="view-tabs" role="tablist">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? "view-tab active" : "view-tab"}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "movers" && (
            <div className="table-scroll">
              <table className="stocks-table">
                <thead>
                  <tr>
                    <th>INSTRUMENT</th>
                    <th>PRICE</th>
                    <th>CHANGE</th>
                    <th>VOLUME</th>
                    <th>PROVIDER</th>
                    <th>RETRIEVED</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {[...(overview?.gainers || []), ...(overview?.losers || [])].map((entry) => (
                    <tr key={`${entry.id}-${entry.quote?.changePercent}`}>
                      <td>
                        <button className="instrument-cell" type="button" onClick={() => onNavigate?.("charts", asInstrument(entry))}>
                          <span className="ticker-icon">{entry.symbol.slice(0, 2)}</span>
                          <span className="instrument-text">
                            <strong>{entry.symbol}</strong>
                            <small>{entry.name}</small>
                          </span>
                        </button>
                      </td>
                      <td className="table-price">{formatMoney(entry.quote?.price, entry.quote?.currency)}</td>
                      <td>
                        <span className={`change-pill ${Number(entry.quote?.changePercent) >= 0 ? "positive" : "negative"}`}>
                          {formatPercent(entry.quote?.changePercent)}
                        </span>
                      </td>
                      <td className="volume-cell">{compactVolume(entry.quote?.volume)}</td>
                      <td className="not-quoted">{entry.quote?.source}</td>
                      <td className="not-quoted">{formatTime(entry.quote?.providerTimestamp || entry.quote?.retrievedAt)}</td>
                      <td>
                        <button
                          type="button"
                          className={watchKeys.has(entry.id) ? "watch-star saved" : "watch-star"}
                          onClick={() => toggleWatch(entry)}
                          aria-label="Toggle watchlist"
                        >
                          ★
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!overview?.gainers?.length && !overview?.losers?.length && (
                    <tr>
                      <td colSpan="7" className="table-empty">
                        No verified quotes are available for movers. Check the coverage panel for provider failures.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="table-footer">
                <span>VOLUME LEADERS: {(overview?.volumeLeaders || []).map((entry) => entry.symbol).join(" · ") || "—"}</span>
                <span>NO FABRICATED PRICES · DELAYED PROVIDER TIERS</span>
              </div>
            </div>
          )}

          {tab === "heatmap" && (
            <div className="heatmap-wrap">
              <div className="heatmap-grid">
                {(overview?.heatmap || []).map((tile) => {
                  const change = Number(tile.changePercent);
                  const tone = !tile.verified
                    ? "unverified"
                    : change > 0
                      ? "up"
                      : change < 0
                        ? "down"
                        : "flat";
                  return (
                    <button
                      key={tile.id}
                      type="button"
                      className={`heat-tile ${tone}`}
                      style={tile.verified ? { opacity: Math.min(1, 0.45 + Math.abs(change) / 6) } : undefined}
                      onClick={() => onNavigate?.("charts", { id: tile.id, symbol: tile.symbol, name: tile.symbol, exchange: "NSE", currency: tile.currency })}
                      title={`${tile.symbol} · ${tile.sector}${tile.verified ? "" : " · no verified quote"}`}
                    >
                      <strong>{tile.symbol}</strong>
                      <span>{tile.verified ? formatPercent(tile.changePercent) : "unverified"}</span>
                      <small>{tile.sector}</small>
                    </button>
                  );
                })}
              </div>
              <div className="table-footer">
                <span>Tile intensity reflects absolute change; unverified instruments are explicitly muted.</span>
                <span>SECTOR: {(overview?.sectors || []).length} WITH VERIFIED MEMBERS</span>
              </div>
            </div>
          )}

          {tab === "sectors" && (
            <div className="table-scroll">
              <table className="stocks-table">
                <thead>
                  <tr>
                    <th>SECTOR</th>
                    <th>AVG CHANGE</th>
                    <th>MEMBERS</th>
                    <th>ADV / DEC</th>
                    <th>INSTRUMENTS</th>
                  </tr>
                </thead>
                <tbody>
                  {(overview?.sectors || []).map((sector) => (
                    <tr key={sector.sector}>
                      <td>{sector.sector}</td>
                      <td>
                        <span className={`change-pill ${Number(sector.averageChangePercent) >= 0 ? "positive" : "negative"}`}>
                          {formatPercent(sector.averageChangePercent)}
                        </span>
                      </td>
                      <td>{sector.count}</td>
                      <td>
                        <span className="positive-text">{sector.advancers}</span> / <span className="negative-text">{sector.decliners}</span>
                      </td>
                      <td className="not-quoted">{sector.instruments.join(" · ")}</td>
                    </tr>
                  ))}
                  {!overview?.sectors?.length && (
                    <tr>
                      <td colSpan="5" className="table-empty">No sector aggregation is possible without verified quotes.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === "instruments" && (
            <>
              <div className="filter-row">
                <label>
                  <span>ASSET TYPE</span>
                  <select value={instrumentType} onChange={(event) => setInstrumentType(event.target.value)}>
                    <option value="">All</option>
                    {["equity", "index", "etf"].map((type) => (
                      <option key={type} value={type}>{ASSET_LABELS[type]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>EXCHANGE</span>
                  <select value={instrumentExchange} onChange={(event) => setInstrumentExchange(event.target.value)}>
                    <option value="">All</option>
                    {["NSE", "BSE", "NASDAQ", "NYSE"].map((exchange) => (
                      <option key={exchange} value={exchange}>{exchange}</option>
                    ))}
                  </select>
                </label>
                <span className="filter-note">
                  {instruments ? `${instruments.total} matched · directory ${instruments.directory?.status || "unfetched"}` : "loading…"}
                </span>
              </div>
              <div className="table-scroll">
                <table className="stocks-table">
                  <thead>
                    <tr>
                      <th>INSTRUMENT</th>
                      <th>TYPE</th>
                      <th>EXCHANGE</th>
                      <th>QUOTE</th>
                      <th>LAST VERIFIED</th>
                      <th>PROVIDERS</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(instruments?.instruments || []).map((instrument) => {
                      const availability = availabilityLabel(instrument);
                      return (
                        <tr key={instrument.id}>
                          <td>
                            <button className="instrument-cell" type="button" onClick={() => onNavigate?.("charts", instrument)}>
                              <span className="ticker-icon">{instrument.symbol.slice(0, 2)}</span>
                              <span className="instrument-text">
                                <strong>{instrument.symbol}</strong>
                                <small>{instrument.name}</small>
                              </span>
                            </button>
                          </td>
                          <td>{ASSET_LABELS[instrument.assetType] || instrument.assetType}</td>
                          <td><span className="exchange-tag">{instrument.exchange}</span></td>
                          <td>
                            <span className={`availability-pill ${availability.tone}`}>{availability.label}</span>
                          </td>
                          <td className="not-quoted">{instrument.availability?.lastQuoteAt ? formatTime(instrument.availability.lastQuoteAt) : "not observed"}</td>
                          <td className="not-quoted">
                            {instrument.availability?.quoteProviders?.length
                              ? instrument.availability.quoteProviders.join(", ")
                              : instrument.availability?.mappedProviders?.length
                                ? `${instrument.availability.mappedProviders.join(", ")} (unconfigured)`
                                : "none mapped"}
                          </td>
                          <td>
                            <button
                              type="button"
                              className={watchKeys.has(instrument.id) ? "watch-star saved" : "watch-star"}
                              onClick={() => toggleWatch(instrument)}
                              aria-label="Toggle watchlist"
                            >
                              ★
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {!instrumentLoading && !instruments?.instruments?.length && (
                      <tr>
                        <td colSpan="7" className="table-empty">
                          {instruments?.error || "No instruments match this query."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <div className="table-footer">
                  <span>
                    PAGE {page + 1} · {instrumentLoading ? "LOADING" : `${instruments?.count ?? 0} SHOWN`}
                  </span>
                  <span className="pager">
                    <button type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0}>
                      ← Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => setPage((value) => value + 1)}
                      disabled={!instruments || (page + 1) * pageSize >= instruments.total}
                    >
                      Next →
                    </button>
                  </span>
                </div>
              </div>
            </>
          )}
        </article>

        <aside className="side-column">
          <article className="market-panel side-panel">
            <div className="side-panel-heading">
              <div>
                <span className="section-kicker">BROWSER-STORED</span>
                <h2>Watchlist</h2>
              </div>
              <span className="chip muted">{watchlist.length}</span>
            </div>
            {watchlist.length ? (
              <div className="side-list">
                {watchlist.map((entry) => {
                  const quote = watchQuotes[`${entry.symbol}|${entry.exchange || "NSE"}`] || null;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className="side-stock"
                      onClick={() => onNavigate?.("charts", entry)}
                    >
                      <span className="ticker-icon small">{entry.symbol.slice(0, 2)}</span>
                      <span>
                        <strong>{entry.symbol}</strong>
                        <small>{entry.name}</small>
                      </span>
                      <b className={quote ? "" : "not-quoted"}>
                        {quote ? formatMoney(quote.price, quote.currency) : "—"}
                      </b>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="side-empty compact">
                <strong>No instruments yet</strong>
                <p>Star an instrument in the table or search the master. Stored in this browser only.</p>
                <div className="side-search">
                  <InstrumentSearch compact onSelect={toggleWatch} placeholder="Add an instrument" />
                </div>
              </div>
            )}
            {watchError && <p className="muted-note">{watchError}</p>}
            {watchlist.length > 0 && (
              <div className="side-search">
                <InstrumentSearch compact onSelect={toggleWatch} placeholder="Add another instrument" />
              </div>
            )}
          </article>

          <article className="market-panel side-panel">
            <div className="side-panel-heading">
              <div>
                <span className="section-kicker">DATA HONESTY</span>
                <h2>Coverage</h2>
              </div>
              <span className={`chip ${coverageTone === "ok" ? "" : "warning"}`}>{coverage?.status?.replaceAll("-", " ") || "—"}</span>
            </div>
            <dl className="mini-metrics">
              <div><dt>Catalogued</dt><dd>{coverage?.instrumentMatrix?.catalogued ?? "—"}</dd></div>
              <div><dt>Quote-capable</dt><dd>{coverage?.instrumentMatrix?.quoteEnabled ?? "—"}</dd></div>
              <div><dt>Verified now</dt><dd>{coverage?.instrumentMatrix?.verifiedLatestQuote ?? "—"}</dd></div>
              <div><dt>Candle-capable</dt><dd>{coverage?.instrumentMatrix?.candleEnabled ?? "—"}</dd></div>
            </dl>
            <p className="muted-note">{overview?.coverage?.freshness?.detail}</p>
            {!!overview?.coverage?.providerFailures?.length && (
              <>
                <h3 className="sub-heading">Provider failures</h3>
                <ul className="failure-list">
                  {overview.coverage.providerFailures.map((failure) => (
                    <li key={failure.provider}>
                      <strong>{failure.provider}</strong>
                      <span>{failure.failures} failed</span>
                      <small>{failure.example}</small>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="integrity-card">
              <span className="integrity-icon">i</span>
              <div>
                <strong>No synthetic data</strong>
                <p>A configured provider is not proof of a quote. Only recent successful observations are labelled verified.</p>
              </div>
            </div>
          </article>
        </aside>
      </div>

      <footer className="dashboard-footer">
        <span>MARKET LENS · RESEARCH &amp; INTELLIGENCE · NOT INVESTMENT ADVICE</span>
        <span>
          QUOTES {overview?.coverage?.verified ?? 0}/{overview?.coverage?.attempted ?? 0} VERIFIED
          <i>·</i>
          {overview?.market?.label || "session unknown"}
          <i>·</i>
          HOLIDAY CALENDAR {overview?.market?.holidayCalendar || "unverified"}
        </span>
      </footer>
    </section>
  );
}
