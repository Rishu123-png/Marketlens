import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/terminal/Icon.jsx";
import TerminalPanel from "../components/terminal/TerminalPanel.jsx";
import InstrumentSearch from "../components/InstrumentSearch.jsx";
import DataStatus from "../components/terminal/DataStatus.jsx";
import PriceChange from "../components/terminal/PriceChange.jsx";
import Sparkline from "../components/terminal/Sparkline.jsx";
import EmptyState from "../components/terminal/EmptyState.jsx";
import MarketTable from "../components/terminal/MarketTable.jsx";
import EvidenceBadge from "../components/terminal/EvidenceBadge.jsx";
import { api, formatMoney, formatTime } from "../lib/api.js";
import { quoteState, summarizeQuotes } from "../lib/marketVisuals.js";
import { evaluateLocalAlert } from "../lib/localAlerts.js";
import { usePersistentState, uid } from "../lib/usePersistentState.js";

const ALERT_TYPES = {
  priceAbove: "Price above",
  priceBelow: "Price below",
  changeAbove: "% change above",
  changeBelow: "% change below"
};

const SUGGESTED = [
  { id: "IN-EQ-TCS", symbol: "TCS", name: "Tata Consultancy Services", exchange: "NSE" },
  { id: "IN-EQ-HDFCBANK", symbol: "HDFCBANK", name: "HDFC Bank", exchange: "NSE" },
  { id: "IN-EQ-INFY", symbol: "INFY", name: "Infosys", exchange: "NSE" },
  { id: "IN-EQ-RELIANCE", symbol: "RELIANCE", name: "Reliance Industries", exchange: "NSE" }
];

export default function Watchlist({ onNavigate }) {
  const [watchlist, setWatchlist] = usePersistentState("marketlens-watchlist-v2", []);
  const [alerts, setAlerts] = usePersistentState("marketlens-alerts-v1", []);
  const [quotes, setQuotes] = useState({});
  const [series, setSeries] = useState({});
  const [failures, setFailures] = useState([]);
  const [batchError, setBatchError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [notice, setNotice] = useState(null);
  const [alertDraft, setAlertDraft] = useState({ key: "", type: "priceAbove", threshold: "" });
  const refreshRequest = useRef(0);

  const targets = useMemo(() => watchlist.slice(0, 24), [watchlist]);

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequest.current;
    if (!targets.length) {
      setQuotes({});
      setFailures([]);
      setBatchError(null);
      setSeries({});
      return;
    }
    setLoading(true);
    setBatchError(null);
    try {
      const data = await api(`/api/quotes?symbols=${encodeURIComponent(targets.map((entry) => `${entry.symbol}@${entry.exchange || "NSE"}`).join(","))}`);
      if (refreshRequest.current !== requestId) return;
      const map = Object.fromEntries((data.quotes || []).map((entry) => [
        `${entry.symbol}|${entry.quote?.exchange || entry.exchange || "NSE"}`,
        entry.quote
      ]));
      setQuotes(map);
      setFailures(data.failures || []);

      const triggered = [];
      const updatedAlerts = alerts.map((alert) => {
        const message = evaluateLocalAlert(alert, map[`${alert.symbol}|${alert.exchange || "NSE"}`]);
        if (!message) return alert;
        const last = alert.lastTriggeredAt ? Date.parse(alert.lastTriggeredAt) : 0;
        if (Date.now() - last < 10 * 60 * 1000) return alert;
        triggered.push(`${alert.symbol}: ${message}`);
        return { ...alert, lastTriggeredAt: new Date().toISOString(), history: [{ at: new Date().toISOString(), message }, ...(alert.history || [])].slice(0, 20) };
      });
      if (triggered.length) {
        setAlerts(updatedAlerts);
        setNotice({ tone: "warn", message: `${triggered.length} local alert(s) triggered during this refresh.` });
      }

      setHistoryLoading(true);
      const histories = await Promise.allSettled(
        targets.slice(0, 8).map(async (entry) => {
          const payload = await api(`/api/history?symbol=${encodeURIComponent(entry.symbol)}&exchange=${encodeURIComponent(entry.exchange || "NSE")}&interval=1day&limit=60`);
          return [`${entry.symbol}|${entry.exchange || "NSE"}`, (payload?.candles || []).map((candle) => Number(candle.close))];
        })
      );
      if (refreshRequest.current !== requestId) return;
      const mapSeries = {};
      for (const item of histories) if (item.status === "fulfilled") mapSeries[item.value[0]] = item.value[1];
      setSeries(mapSeries);
    } catch (cause) {
      if (refreshRequest.current === requestId) {
        setQuotes({});
        setSeries({});
        setFailures([]);
        setBatchError(cause.message || "The quote batch could not be retrieved.");
      }
    } finally {
      if (refreshRequest.current === requestId) {
        setLoading(false);
        setHistoryLoading(false);
      }
    }
  }, [targets, alerts, setAlerts]);

  useEffect(() => {
    refresh();
    return () => { refreshRequest.current += 1; };
    // Refresh is bound to the watchlist identity, not each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets.map((entry) => `${entry.symbol}|${entry.exchange}`).join(",")]);

  function add(instrument) {
    setWatchlist((current) => current.some((item) => item.symbol === instrument.symbol && item.exchange === instrument.exchange)
      ? current
      : [...current, { id: instrument.id || uid("watch"), symbol: instrument.symbol, name: instrument.name, exchange: instrument.exchange, currency: instrument.currency || "INR" }]);
    setNotice({ tone: "ok", message: `${instrument.symbol} added to this browser watchlist.` });
  }

  function remove(instrument) {
    setWatchlist((current) => current.filter((item) => !(item.symbol === instrument.symbol && item.exchange === instrument.exchange)));
  }

  function addAlert(event) {
    event.preventDefault();
    const clean = alertDraft.threshold.trim();
    if (!alertDraft.key || !clean || !Number.isFinite(Number(clean)) || (alertDraft.type.startsWith("price") && !(Number(clean) > 0))) {
      setNotice({ tone: "bad", message: "Choose an instrument and enter a valid threshold (price thresholds must be positive)." });
      return;
    }
    const entry = watchlist.find((item) => `${item.symbol}|${item.exchange || "NSE"}` === alertDraft.key);
    if (!entry) { setNotice({ tone: "bad", message: "Choose an instrument still in the watchlist." }); return; }
    setAlerts((current) => [
      {
        id: uid("alert"),
        symbol: entry.symbol,
        exchange: entry.exchange || "NSE",
        type: alertDraft.type,
        threshold: clean,
        createdAt: new Date().toISOString()
      },
      ...current
    ].slice(0, 50));
    setAlertDraft({ key: "", type: "priceAbove", threshold: "" });
    setNotice({ tone: "ok", message: "Local alert saved. Alerts are evaluated only when quotes refresh." });
  }

  const rows = useMemo(() => watchlist.map((item) => {
    const key = `${item.symbol}|${item.exchange || "NSE"}`;
    const quote = quotes[key] || null;
    return { ...item, key, quote, state: quoteState(quote), spark: series[key] || [] };
  }), [watchlist, quotes, series]);

  const columns = [
    {
      key: "symbol",
      label: "INSTRUMENT",
      value: (row) => row.symbol,
      render: (row) => (
        <button type="button" className="table-instrument" onClick={() => onNavigate("markets", row)}>
          <span>{row.symbol.slice(0, 2)}</span>
          <div><strong>{row.symbol}</strong><small>{row.name} · {row.exchange}</small></div>
        </button>
      )
    },
    { key: "price", label: "PRICE", align: "right", value: (row) => row.quote?.price ?? null, render: (row) => row.state.code !== "unavailable" ? formatMoney(row.quote.price, row.quote.currency) : "—" },
    { key: "change", label: "CHANGE", align: "right", value: (row) => row.quote?.changePercent ?? null, render: (row) => row.state.code !== "unavailable" ? <PriceChange value={row.quote.changePercent} percent size="sm" /> : <span className="muted">—</span> },
    { key: "state", label: "DATA STATE", value: (row) => row.state.code, render: (row) => <DataStatus state={row.state} compact /> },
    { key: "spark", label: "60D HISTORY", value: (row) => row.spark.length, render: (row) => <Sparkline points={row.spark} width={88} height={24} positive={(row.quote?.changePercent || 0) >= 0} label={row.spark.length ? "Verified close history" : "No verified history"} /> },
    { key: "updated", label: "RETRIEVED", value: (row) => row.quote?.retrievedAt || "", render: (row) => <span className="muted">{row.quote ? formatTime(row.quote.retrievedAt) : "—"}</span> },
    {
      key: "actions",
      label: "",
      sortable: false,
      width: 156,
      render: (row) => (
        <div className="row-actions">
          <button type="button" onClick={() => onNavigate("research", row)}>Research</button>
          <button type="button" onClick={() => onNavigate("markets", row)}>Chart</button>
          <button type="button" className="danger" onClick={() => remove(row)}>Remove</button>
        </div>
      )
    }
  ];

  return (
    <section className="workspace watchlist-workspace">
      <header className="workspace-head">
        <div>
          <span className="workspace-kicker">WATCHLIST · BROWSER LOCAL</span>
          <h1>Watchlist</h1>
          <p>Saved instruments, provider-verified marks, 60-day close history and local alert rules. Nothing is sent to a broker.</p>
        </div>
        <div className="workspace-head-actions">
          <span className="head-date">{watchlist.length} instruments · {alerts.length} local alerts</span>
          <button type="button" className="t-btn secondary sm" onClick={refresh} disabled={loading}><Icon name="refresh" size={13} className={loading ? "spin" : ""} /> Refresh marks</button>
        </div>
      </header>

      {notice && <div className={`inline-alert ${notice.tone === "bad" ? "error" : "info"}`} role="status"><Icon name={notice.tone === "bad" ? "warn" : "check"} size={15} /><div><strong>{notice.tone === "bad" ? "Watchlist" : "Saved"}</strong><span>{notice.message}</span></div></div>}
      {batchError && <div className="inline-alert error" role="alert"><Icon name="warn" size={15} /><div><strong>Quote batch unavailable</strong><span>{batchError} No individual results were returned; saved instruments remain without prices.</span></div></div>}
      {!batchError && failures.length > 0 && <div className="inline-alert"><Icon name="warn" size={15} /><div><strong>Some marks are unavailable</strong><span>{failures.length} instrument(s) returned no verified quote. They remain in the list without a price.</span></div></div>}

      <div className="watchlist-grid">
        <div className="watchlist-main">
          <TerminalPanel kicker="TRACKED" title="Saved instruments" actions={<div className="watchlist-search"><InstrumentSearch compact onSelect={add} placeholder="Add instrument…" /></div>} className="watchlist-table-panel">
            {watchlist.length ? (
              <MarketTable columns={columns} rows={rows} empty="No saved instruments." />
            ) : (
              <div className="watchlist-zero">
                <EmptyState icon="watchlist" title="Your watchlist is empty" detail="Add a catalogued instrument. A saved symbol does not imply that a live price exists." />
                <div className="quick-add-grid">
                  {SUGGESTED.map((instrument) => (
                    <button key={instrument.id} type="button" onClick={() => add(instrument)}>
                      <span>{instrument.symbol.slice(0, 2)}</span>
                      <div><strong>{instrument.symbol}</strong><small>{instrument.name}</small></div>
                      <Icon name="plus" size={12} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </TerminalPanel>

          <TerminalPanel kicker="ALERT RULES" title="Local triggers" actions={<EvidenceBadge tone="unverified">Browser evaluated</EvidenceBadge>} className="watchlist-alerts-panel">
            <form onSubmit={addAlert} className="alert-form">
              <label className="field"><span>INSTRUMENT</span><select value={alertDraft.key} onChange={(event) => setAlertDraft({ ...alertDraft, key: event.target.value })}><option value="">Choose from watchlist</option>{watchlist.map((item) => <option key={`${item.symbol}|${item.exchange}`} value={`${item.symbol}|${item.exchange || "NSE"}`}>{item.symbol} · {item.exchange}</option>)}</select></label>
              <label className="field"><span>RULE</span><select value={alertDraft.type} onChange={(event) => setAlertDraft({ ...alertDraft, type: event.target.value })}>{Object.entries(ALERT_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="field"><span>THRESHOLD</span><div className="threshold-row"><input type="number" step="any" value={alertDraft.threshold} onChange={(event) => setAlertDraft({ ...alertDraft, threshold: event.target.value })} placeholder="0.00" /><button type="submit" className="t-btn primary sm">Add alert</button></div></label>
            </form>
            {alerts.length ? (
              <div className="alert-list">
                {alerts.map((alert) => (
                  <div key={alert.id} className="alert-row">
                    <span className="alert-icon"><Icon name="bell" size={12} /></span>
                    <div><strong>{alert.symbol} · {alert.exchange} · {ALERT_TYPES[alert.type]}</strong><small>{alert.threshold} · {alert.lastTriggeredAt ? `last triggered ${formatTime(alert.lastTriggeredAt)}` : "not triggered yet"}</small></div>
                    <button type="button" onClick={() => setAlerts((current) => current.filter((entry) => entry.id !== alert.id))} aria-label="Delete alert"><Icon name="x" size={10} /></button>
                  </div>
                ))}
              </div>
            ) : <p className="inline-note">No local alert rules. Alerts evaluate only while this view refreshes, using verified live/delayed quotes with a provider timestamp no older than 24 hours. They never place orders.</p>}
          </TerminalPanel>
        </div>

        <aside className="watchlist-side">
          <TerminalPanel kicker="PORTFOLIO LINK" title="Research next" className="watchlist-research">
            <p className="panel-paragraph">Move from a saved instrument to a six-agent report. The report keeps the provider provenance and deterministic gate.</p>
            <button type="button" className="t-btn primary full" onClick={() => onNavigate("research", watchlist[0] || undefined)} disabled={!watchlist.length}><Icon name="ai" size={12} /> Research first instrument</button>
            <button type="button" className="t-btn secondary full" onClick={() => onNavigate("screener")}>Screen the universe</button>
          </TerminalPanel>
          <TerminalPanel kicker="DATA STATE" title="What is verified" className="watchlist-coverage">
            <div className="kv-list">
              <div><span>Instruments saved</span><strong>{watchlist.length}</strong></div>
              <div><span>Verified quotes</span><strong>{rows.filter((row) => row.quote).length}</strong></div>
              <div><span>History series</span><strong>{Object.values(series).filter((values) => values.length > 1).length}</strong></div>
              <div><span>Local alerts</span><strong>{alerts.length}</strong></div>
              <div><span>Quote state</span><DataStatus state={summarizeQuotes(rows)} compact /></div>
            </div>
            <p className="provenance-note">{historyLoading ? "Loading close history…" : "History uses up to 8 verified candle responses; quote refresh covers up to 24 instruments."}</p>
          </TerminalPanel>
          <TerminalPanel kicker="SHORTCUTS" title="More workspace" className="watchlist-shortcuts">
            <button type="button" onClick={() => onNavigate("markets")}><Icon name="markets" size={14} /><span><strong>Markets</strong><small>Chart and structure</small></span><Icon name="chevronRight" size={12} /></button>
            <button type="button" onClick={() => onNavigate("trading")}><Icon name="trading" size={14} /><span><strong>Virtual Trading</strong><small>Practice without risk</small></span><Icon name="chevronRight" size={12} /></button>
            <button type="button" onClick={() => onNavigate("news")}><Icon name="news" size={14} /><span><strong>News &amp; Events</strong><small>Evidence timeline</small></span><Icon name="chevronRight" size={12} /></button>
          </TerminalPanel>
        </aside>
      </div>
    </section>
  );
}
