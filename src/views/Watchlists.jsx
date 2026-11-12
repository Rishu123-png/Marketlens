import { useCallback, useEffect, useMemo, useState } from "react";
import InstrumentSearch from "../components/InstrumentSearch.jsx";
import { api, formatMoney, formatPercent, formatTime } from "../lib/api.js";
import { usePersistentState, uid } from "../lib/usePersistentState.js";

const ALERT_TYPES = {
  priceAbove: { label: "Price above", unit: "price", numeric: true },
  priceBelow: { label: "Price below", unit: "price", numeric: true },
  changeAbove: { label: "% change above", unit: "%", numeric: true },
  changeBelow: { label: "% change below", unit: "%", numeric: true },
  volumeAbove: { label: "Volume above", unit: "shares", numeric: true },
  rsiAbove: { label: "RSI(14) above", unit: "rsi", numeric: true },
  rsiBelow: { label: "RSI(14) below", unit: "rsi", numeric: true },
  news: { label: "News keyword", unit: "keyword", numeric: false }
};

function defaultLists() {
  return [{ id: uid("wl"), name: "Core", instruments: [] }];
}

function evaluateIndicator(alert, rsiValue) {
  if (!Number.isFinite(rsiValue)) return null;
  if (alert.type === "rsiAbove" && rsiValue > Number(alert.threshold)) {
    return `RSI(14) ${rsiValue.toFixed(1)} above ${alert.threshold}`;
  }
  if (alert.type === "rsiBelow" && rsiValue < Number(alert.threshold)) {
    return `RSI(14) ${rsiValue.toFixed(1)} below ${alert.threshold}`;
  }
  return null;
}

function evaluate(alert, quote) {
  if (!quote) return null;
  const price = Number(quote.price);
  const change = Number(quote.changePercent);
  const volume = Number(quote.volume);

  switch (alert.type) {
    case "priceAbove":
      return Number.isFinite(price) && price > Number(alert.threshold) ? `Price ${formatMoney(price, quote.currency)} above ${alert.threshold}` : null;
    case "priceBelow":
      return Number.isFinite(price) && price < Number(alert.threshold) ? `Price ${formatMoney(price, quote.currency)} below ${alert.threshold}` : null;
    case "changeAbove":
      return Number.isFinite(change) && change > Number(alert.threshold) ? `Change ${formatPercent(change)} above ${alert.threshold}%` : null;
    case "changeBelow":
      return Number.isFinite(change) && change < Number(alert.threshold) ? `Change ${formatPercent(change)} below ${alert.threshold}%` : null;
    case "volumeAbove":
      return Number.isFinite(volume) && volume > Number(alert.threshold) ? `Volume ${volume.toLocaleString("en-IN")} above ${alert.threshold}` : null;
    default:
      return null;
  }
}

export default function Watchlists({ onNavigate }) {
  const [lists, setLists] = usePersistentState("marketlens-watchlists-v2", defaultLists());
  const [activeId, setActiveId] = usePersistentState("marketlens-active-watchlist", null);
  const [alerts, setAlerts] = usePersistentState("marketlens-alerts-v1", []);
  const [quotes, setQuotes] = useState({});
  const [quoteErrors, setQuoteErrors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [alertDraft, setAlertDraft] = useState({ symbol: "", type: "priceAbove", threshold: "", keyword: "" });
  const [notice, setNotice] = useState(null);

  const active = lists.find((list) => list.id === activeId) || lists[0];

  useEffect(() => {
    if (!activeId && lists[0]) setActiveId(lists[0].id);
  }, [activeId, lists, setActiveId]);

  // A symbol alone is not an identity: the same company can be listed on NSE and
  // BSE. Requests carry SYMBOL@EXCHANGE and quotes are keyed the same way.
  const symbols = useMemo(() => {
    const entries = [
      ...(active?.instruments || []).map((entry) => ({
        symbol: entry.symbol,
        exchange: entry.exchange || "NSE"
      })),
      ...alerts.map((alert) => ({ symbol: alert.symbol, exchange: alert.exchange || "NSE" }))
    ];
    const seen = new Set();
    const targets = [];
    for (const entry of entries) {
      const key = `${entry.symbol}|${entry.exchange}`;
      if (!entry.symbol || seen.has(key)) continue;
      seen.add(key);
      targets.push(entry);
      if (targets.length >= 24) break;
    }
    return targets;
  }, [active, alerts]);

  const quoteFor = useCallback(
    (symbol, exchange = "NSE") => quotes[`${symbol}|${exchange}`] || null,
    [quotes]
  );

  const refresh = useCallback(async () => {
    if (!symbols.length) {
      setQuotes({});
      setQuoteErrors([]);
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      const data = await api(
        `/api/quotes?symbols=${encodeURIComponent(symbols.map((entry) => `${entry.symbol}@${entry.exchange}`).join(","))}`
      );
      const map = Object.fromEntries(
        (data.quotes || []).map((entry) => [`${entry.symbol}|${entry.quote?.exchange || entry.exchange || "NSE"}`, entry.quote])
      );
      setQuotes(map);
      setQuoteErrors(data.failures || []);

      const triggered = [];
      setAlerts((current) =>
        current.map((alert) => {
          if (alert.type === "news") return alert;
          const message = evaluate(alert, map[`${alert.symbol}|${alert.exchange || "NSE"}`]);
          if (!message) return alert;
          const last = alert.lastTriggeredAt ? Date.parse(alert.lastTriggeredAt) : 0;
          if (Date.now() - last < 10 * 60 * 1000) return alert;
          triggered.push(`${alert.symbol}: ${message}`);
          return {
            ...alert,
            lastTriggeredAt: new Date().toISOString(),
            history: [{ at: new Date().toISOString(), message }, ...(alert.history || [])].slice(0, 20)
          };
        })
      );

      const newsAlerts = alerts.filter((alert) => alert.type === "news" && alert.keyword);
      const newsSymbols = [...new Set(newsAlerts.map((alert) => alert.symbol))].slice(0, 3);
      for (const symbol of newsSymbols) {
        try {
          const news = await api(`/api/news?symbol=${encodeURIComponent(symbol)}&limit=20&filings=false`);
          const matches = (news.evidence || []).filter((item) =>
            `${item.metadata?.title || ""} ${item.excerpt || ""}`.toLowerCase().includes(String(newsAlerts.find((alert) => alert.symbol === symbol)?.keyword || "").toLowerCase())
          );
          if (matches.length) {
            setAlerts((current) =>
              current.map((alert) => {
                if (alert.type !== "news" || alert.symbol !== symbol) return alert;
                const fresh = matches.filter((item) => !(alert.seenIds || []).includes(item.id));
                if (!fresh.length) return alert;
                return {
                  ...alert,
                  lastTriggeredAt: new Date().toISOString(),
                  seenIds: [...(alert.seenIds || []), ...fresh.map((item) => item.id)].slice(-50),
                  history: [
                    { at: new Date().toISOString(), message: `${fresh.length} news item(s) matched “${alert.keyword}”` },
                    ...(alert.history || [])
                  ].slice(0, 20)
                };
              })
            );
          }
        } catch {
          /* news coverage is optional; do not fail the watchlist refresh */
        }
      }

      // Indicator alerts need candles, which the quote batch does not carry.
      // Fetch them only for symbols that actually have an RSI rule.
      const rsiTargets = [];
      const rsiSeen = new Set();
      for (const alert of alerts) {
        if (alert.type !== "rsiAbove" && alert.type !== "rsiBelow") continue;
        const exchange = alert.exchange || "NSE";
        const key = `${alert.symbol}|${exchange}`;
        if (rsiSeen.has(key)) continue;
        rsiSeen.add(key);
        rsiTargets.push({ symbol: alert.symbol, exchange });
        if (rsiTargets.length >= 8) break;
      }
      const rsiValues = {};
      for (const target of rsiTargets) {
        try {
          const analysis = await api(
            `/api/analysis?symbol=${encodeURIComponent(target.symbol)}` +
              `&exchange=${encodeURIComponent(target.exchange)}&interval=1day&limit=160`
          );
          const value = Number(analysis?.indicators?.rsi);
          if (Number.isFinite(value)) rsiValues[`${target.symbol}|${target.exchange}`] = value;
        } catch {
          /* Missing candles leave the alert untriggered; never guess RSI. */
        }
      }

      if (rsiTargets.length) {
        setAlerts((current) =>
          current.map((alert) => {
            if (alert.type !== "rsiAbove" && alert.type !== "rsiBelow") return alert;
            const message = evaluateIndicator(alert, rsiValues[`${alert.symbol}|${alert.exchange || "NSE"}`]);
            if (!message || alert.lastTriggeredMessage === message) return alert;
            triggered.push(message);
            return {
              ...alert,
              lastTriggeredAt: new Date().toISOString(),
              lastTriggeredMessage: message,
              history: [{ at: new Date().toISOString(), message }, ...(alert.history || [])].slice(0, 20)
            };
          })
        );
      }

      if (triggered.length) setNotice({ tone: "ok", text: `${triggered.length} alert(s) triggered: ${triggered.slice(0, 3).join(" · ")}` });
    } catch (cause) {
      setNotice({ tone: "bad", text: cause.message });
    } finally {
      setLoading(false);
    }
  }, [symbols, alerts, setAlerts]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.map((entry) => `${entry.symbol}|${entry.exchange}`).join(",")]);

  function addInstrument(instrument) {
    if (!active) return;
    setLists((current) =>
      current.map((list) =>
        list.id === active.id
          ? { ...list, instruments: [...list.instruments, instrument].filter((entry, index, all) => all.findIndex((item) => item.id === entry.id) === index) }
          : list
      )
    );
  }

  function removeInstrument(id) {
    setLists((current) =>
      current.map((list) => (list.id === active.id ? { ...list, instruments: list.instruments.filter((entry) => entry.id !== id) } : list))
    );
  }

  function createList() {
    const name = newName.trim() || `Watchlist ${lists.length + 1}`;
    const list = { id: uid("wl"), name, instruments: [] };
    setLists((current) => [...current, list]);
    setActiveId(list.id);
    setNewName("");
  }

  function deleteList() {
    if (lists.length <= 1) return;
    const remaining = lists.filter((list) => list.id !== active.id);
    setLists(remaining);
    setActiveId(remaining[0].id);
  }

  function createAlert(event) {
    event.preventDefault();
    const symbol = alertDraft.symbol.trim().toUpperCase() || active?.instruments[0]?.symbol;
    if (!symbol) {
      setNotice({ tone: "bad", text: "Choose an instrument for the alert." });
      return;
    }
    const known = [...(active?.instruments || []), ...alerts].find((entry) => entry.symbol === symbol);
    if (ALERT_TYPES[alertDraft.type].numeric && !Number.isFinite(Number(alertDraft.threshold))) {
      setNotice({ tone: "bad", text: "Enter a numeric threshold." });
      return;
    }
    if (alertDraft.type === "news" && !alertDraft.keyword.trim()) {
      setNotice({ tone: "bad", text: "Enter a news keyword." });
      return;
    }

    setAlerts((current) => [
      ...current,
      {
        id: uid("alert"),
        symbol,
        exchange: known?.exchange || "NSE",
        name: known?.name || symbol,
        type: alertDraft.type,
        threshold: alertDraft.threshold,
        keyword: alertDraft.keyword.trim(),
        createdAt: new Date().toISOString(),
        lastTriggeredAt: null,
        history: []
      }
    ]);
    setAlertDraft({ ...alertDraft, threshold: "", keyword: "" });
  }

  const history = alerts
    .flatMap((alert) => (alert.history || []).map((entry) => ({ ...entry, alert })))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 30);

  return (
    <section className="lab">
      <header className="lab-heading">
        <div>
          <span className="eyebrow">WATCHLISTS &amp; ALERTS</span>
          <h1>
            Persistent lists, <span>honest trigger history.</span> Indicator alerts need candle history and stay
            untriggered when a provider cannot supply it.
          </h1>
          <p>
            Multiple watchlists and alert rules stored in this browser. Alerts are evaluated when you refresh this
            page against provider-verified quotes; there is no background server that guarantees delivery.
          </p>
        </div>
        <div className="heading-side">
          <span className="chip muted">browser storage</span>
          <span className="chip">{alerts.length} alerts</span>
        </div>
      </header>

      {notice && (
        <div className={`notice ${notice.tone === "bad" ? "error" : "info"}`} role="status">
          <strong>{notice.tone === "bad" ? "Alert engine" : "Triggered"}</strong>
          <p>{notice.text}</p>
        </div>
      )}

      <div className="watchlist-tabs">
        {lists.map((list) => (
          <button
            key={list.id}
            type="button"
            className={active?.id === list.id ? "watchlist-tab active" : "watchlist-tab"}
            onClick={() => setActiveId(list.id)}
          >
            {list.name} <span>{list.instruments.length}</span>
          </button>
        ))}
        <span className="watchlist-create">
          <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="New watchlist" aria-label="New watchlist name" />
          <button type="button" className="ghost-action" onClick={createList}>Add</button>
        </span>
      </div>

      <div className="lab-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="section-kicker">{active?.name || "WATCHLIST"}</span>
              <h2>{active?.instruments.length || 0} instruments</h2>
            </div>
            <div className="panel-actions">
              <button type="button" className="ghost-action" onClick={refresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh quotes"}</button>
              <button type="button" className="ghost-action danger" onClick={deleteList} disabled={lists.length <= 1}>Delete list</button>
            </div>
          </div>

          <div className="side-search wide">
            <InstrumentSearch onSelect={addInstrument} placeholder="Add an instrument to this watchlist" />
          </div>

          <div className="table-scroll">
            <table className="stocks-table">
              <thead>
                <tr>
                  <th>INSTRUMENT</th>
                  <th>PRICE</th>
                  <th>CHANGE</th>
                  <th>PROVIDER</th>
                  <th>RETRIEVED</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(active?.instruments || []).map((instrument) => {
                  const quote = quoteFor(instrument.symbol, instrument.exchange);
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
                      <td className="table-price">{quote ? formatMoney(quote.price, quote.currency) : "—"}</td>
                      <td>
                        {quote ? (
                          <span className={`change-pill ${Number(quote.changePercent) >= 0 ? "positive" : "negative"}`}>
                            {formatPercent(quote.changePercent)}
                          </span>
                        ) : (
                          <span className="not-quoted">unverified</span>
                        )}
                      </td>
                      <td className="not-quoted">{quote?.source || "—"}</td>
                      <td className="not-quoted">{quote ? formatTime(quote.providerTimestamp || quote.retrievedAt) : "—"}</td>
                      <td>
                        <button type="button" className="clear-search" onClick={() => removeInstrument(instrument.id)} aria-label="Remove">×</button>
                      </td>
                    </tr>
                  );
                })}
                {!active?.instruments.length && (
                  <tr><td colSpan="6" className="table-empty">Add instruments with the search box above.</td></tr>
                )}
              </tbody>
            </table>
            <div className="table-footer">
              <span>{quoteErrors.length} without a verified quote</span>
              <span>ALERTS EVALUATE ON REFRESH · NOT A GUARANTEED DELIVERY CHANNEL</span>
            </div>
          </div>
        </article>

        <aside className="lab-side">
          <article className="panel">
            <div className="panel-head compact">
              <h2>New alert</h2>
            </div>
            <form className="alert-form" onSubmit={createAlert}>
              <label>
                <span>SYMBOL</span>
                <input
                  value={alertDraft.symbol}
                  onChange={(event) => setAlertDraft({ ...alertDraft, symbol: event.target.value })}
                  placeholder={active?.instruments[0]?.symbol || "RELIANCE"}
                />
              </label>
              <label>
                <span>TYPE</span>
                <select value={alertDraft.type} onChange={(event) => setAlertDraft({ ...alertDraft, type: event.target.value })}>
                  {Object.entries(ALERT_TYPES).map(([value, meta]) => (
                    <option key={value} value={value}>{meta.label}</option>
                  ))}
                </select>
              </label>
              {ALERT_TYPES[alertDraft.type].numeric ? (
                <label>
                  <span>THRESHOLD ({ALERT_TYPES[alertDraft.type].unit})</span>
                  <input
                    type="number"
                    step="any"
                    value={alertDraft.threshold}
                    onChange={(event) => setAlertDraft({ ...alertDraft, threshold: event.target.value })}
                  />
                </label>
              ) : (
                <label>
                  <span>KEYWORD</span>
                  <input
                    value={alertDraft.keyword}
                    onChange={(event) => setAlertDraft({ ...alertDraft, keyword: event.target.value })}
                    placeholder="order win, results, board meeting"
                  />
                </label>
              )}
              <button type="submit" className="primary-action">Create alert</button>
            </form>
          </article>

          <article className="panel">
            <div className="panel-head compact">
              <h2>Rules</h2>
            </div>
            <ul className="alert-rules">
              {alerts.map((alert) => (
                <li key={alert.id}>
                  <div>
                    <strong>{alert.symbol}</strong>
                    <span>{ALERT_TYPES[alert.type].label}</span>
                    <small>
                      {alert.type === "news" ? `“${alert.keyword}”` : alert.threshold}
                      {alert.lastTriggeredAt ? ` · last ${formatTime(alert.lastTriggeredAt)}` : " · not triggered"}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="clear-search"
                    onClick={() => setAlerts((current) => current.filter((item) => item.id !== alert.id))}
                    aria-label="Delete alert"
                  >
                    ×
                  </button>
                </li>
              ))}
              {!alerts.length && <li className="muted-note">No alert rules yet.</li>}
            </ul>
          </article>

          <article className="panel">
            <div className="panel-head compact">
              <h2>Alert history</h2>
            </div>
            <ul className="alert-history">
              {history.map((entry, index) => (
                <li key={index}>
                  <span>{formatTime(entry.at)}</span>
                  <p>{entry.alert.symbol}: {entry.message}</p>
                </li>
              ))}
              {!history.length && <li className="muted-note">No alerts have fired.</li>}
            </ul>
          </article>
        </aside>
      </div>
    </section>
  );
}
