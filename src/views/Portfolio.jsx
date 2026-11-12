import { useCallback, useEffect, useMemo, useState } from "react";
import InstrumentSearch from "../components/InstrumentSearch.jsx";
import { api, formatMoney, formatPercent } from "../lib/api.js";
import { usePersistentState, uid } from "../lib/usePersistentState.js";

export default function Portfolio({ onNavigate }) {
  const [holdings, setHoldings] = usePersistentState("marketlens-portfolio-v1", []);
  const [trades, setTrades] = usePersistentState("marketlens-portfolio-trades-v1", []);
  const [quotes, setQuotes] = useState({});
  const [failures, setFailures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState({ instrument: null, qty: "", avgCost: "" });
  const [notice, setNotice] = useState(null);

  const loadQuotes = useCallback(async () => {
    const seen = new Set();
    const symbols = [];
    for (const holding of holdings) {
      const key = `${holding.symbol}|${holding.exchange || "NSE"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      symbols.push({ symbol: holding.symbol, exchange: holding.exchange || "NSE" });
      if (symbols.length >= 24) break;
    }
    if (!symbols.length) {
      setQuotes({});
      return;
    }
    setLoading(true);
    try {
      const data = await api(
        `/api/quotes?symbols=${encodeURIComponent(symbols.map((entry) => `${entry.symbol}@${entry.exchange}`).join(","))}`
      );
      setQuotes(
        Object.fromEntries(
          (data.quotes || []).map((entry) => [`${entry.symbol}|${entry.quote?.exchange || entry.exchange || "NSE"}`, entry.quote])
        )
      );
      setFailures(data.failures || []);
    } catch (cause) {
      setNotice({ tone: "bad", text: cause.message });
    } finally {
      setLoading(false);
    }
  }, [holdings]);

  useEffect(() => {
    loadQuotes();
  }, [loadQuotes]);

  const rows = useMemo(
    () =>
      holdings.map((holding) => {
        // Never fall back to another venue: an NSE price is not a BSE quote.
        const quote = quotes[`${holding.symbol}|${holding.exchange || "NSE"}`] || null;
        const invested = holding.qty * holding.avgCost;
        const value = quote ? holding.qty * Number(quote.price) : null;
        return {
          ...holding,
          quote,
          invested,
          value,
          pnl: value === null ? null : value - invested,
          pnlPercent: value === null || invested === 0 ? null : ((value - invested) / invested) * 100
        };
      }),
    [holdings, quotes]
  );

  const totals = useMemo(() => {
    const invested = rows.reduce((sum, row) => sum + row.invested, 0);
    const valued = rows.filter((row) => row.value !== null);
    const value = valued.reduce((sum, row) => sum + row.value, 0);
    const coveredInvested = valued.reduce((sum, row) => sum + row.invested, 0);
    const pnl = value - coveredInvested;
    const weights = valued.map((row) => value ? row.value / value : 0);
    const hhi = weights.reduce((sum, weight) => sum + weight * weight, 0);
    return {
      invested,
      value,
      coveredInvested,
      pnl,
      pnlPercent: coveredInvested ? (pnl / coveredInvested) * 100 : null,
      hhi,
      unverifiedInvested: invested - coveredInvested,
      largest: valued.sort((a, b) => (b.value || 0) - (a.value || 0))[0] || null
    };
  }, [rows]);

  const sectorExposure = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      const value = row.value ?? row.invested;
      const bucket = map.get(row.sector || "Unclassified") || { sector: row.sector || "Unclassified", value: 0, count: 0, verified: 0 };
      bucket.value += value;
      bucket.count += 1;
      if (row.value !== null) bucket.verified += 1;
      map.set(bucket.sector, bucket);
    }
    const total = [...map.values()].reduce((sum, bucket) => sum + bucket.value, 0);
    return [...map.values()]
      .map((bucket) => ({ ...bucket, weight: total ? (bucket.value / total) * 100 : 0 }))
      .sort((a, b) => b.weight - a.weight);
  }, [rows]);

  function addOrBuy(event) {
    event.preventDefault();
    const instrument = draft.instrument;
    const qty = Number(draft.qty);
    const avgCost = Number(draft.avgCost);
    if (!instrument) {
      setNotice({ tone: "bad", text: "Choose an instrument with the search box." });
      return;
    }
    if (!(qty > 0)) {
      setNotice({ tone: "bad", text: "Quantity must be greater than zero." });
      return;
    }

    setHoldings((current) => {
      const existing = current.find((holding) => holding.symbol === instrument.symbol && holding.exchange === instrument.exchange);
      if (!existing) {
        return [
          ...current,
          {
            id: uid("holding"),
            symbol: instrument.symbol,
            exchange: instrument.exchange,
            name: instrument.name,
            currency: instrument.currency || "INR",
            sector: instrument.sector || "Unclassified",
            qty,
            avgCost: avgCost || 0
          }
        ];
      }
      const nextQty = existing.qty + qty;
      const nextCost = avgCost > 0 ? (existing.avgCost * existing.qty + avgCost * qty) / nextQty : existing.avgCost;
      return current.map((holding) =>
        holding.id === existing.id ? { ...holding, qty: nextQty, avgCost: Number(nextCost.toFixed(4)) } : holding
      );
    });

    setTrades((current) => [
      {
        id: uid("trade"),
        at: new Date().toISOString(),
        side: "BUY",
        symbol: instrument.symbol,
        exchange: instrument.exchange,
        qty,
        price: avgCost || null
      },
      ...current
    ].slice(0, 200));
    setNotice({ tone: "ok", text: `Recorded virtual BUY ${qty} ${instrument.symbol}. No order was placed.` });
    setDraft({ instrument: null, qty: "", avgCost: "" });
  }

  function sell(holding) {
    const raw = window.prompt(`Sell how many ${holding.symbol}? Held: ${holding.qty}`);
    const qty = Number(raw);
    if (!(qty > 0)) return;
    if (qty > holding.qty) {
      setNotice({ tone: "bad", text: "Cannot sell more than the virtual position." });
      return;
    }
    setHoldings((current) =>
      current
        .map((entry) => (entry.id === holding.id ? { ...entry, qty: entry.qty - qty } : entry))
        .filter((entry) => entry.qty > 0)
    );
    setTrades((current) => [
      {
        id: uid("trade"),
        at: new Date().toISOString(),
        side: "SELL",
        symbol: holding.symbol,
        exchange: holding.exchange,
        qty,
        price: quotes[holding.symbol]?.price ?? null
      },
      ...current
    ].slice(0, 200));
    setNotice({ tone: "ok", text: `Recorded virtual SELL ${qty} ${holding.symbol}.` });
  }

  return (
    <section className="lab">
      <header className="lab-heading">
        <div>
          <span className="eyebrow">VIRTUAL PORTFOLIO</span>
          <h1>
            Hypothetical positions, <span>real arithmetic.</span>
          </h1>
          <p>
            Track hypothetical holdings and performance using provider-verified prices. Positions with no verified quote
            are marked at cost and excluded from P&amp;L, not silently filled with a stale price. This is not order
            execution and no broker is connected.
          </p>
        </div>
        <div className="heading-side">
          <span className="chip muted">research only</span>
          <button type="button" className="ghost-action" onClick={loadQuotes} disabled={loading}>
            {loading ? "Marking…" : "Refresh marks"}
          </button>
        </div>
      </header>

      {notice && (
        <div className={`notice ${notice.tone === "bad" ? "error" : "info"}`} role="status">
          <strong>{notice.tone === "bad" ? "Portfolio" : "Recorded"}</strong>
          <p>{notice.text}</p>
        </div>
      )}

      <div className="summary-grid">
        <article className="summary-card">
          <div className="summary-label"><span>INVESTED</span></div>
          <strong>{formatMoney(totals.invested)}</strong>
          <small>virtual cost basis</small>
        </article>
        <article className="summary-card">
          <div className="summary-label"><span>MARKET VALUE</span></div>
          <strong>{totals.value ? formatMoney(totals.value) : "—"}</strong>
          <small>{totals.unverifiedInvested ? `${formatMoney(totals.unverifiedInvested)} at cost (unverified)` : "all positions marked"}</small>
        </article>
        <article className="summary-card">
          <div className="summary-label"><span>UNREALISED P&L</span></div>
          <strong className={totals.pnl >= 0 ? "positive-text" : "negative-text"}>
            {totals.coveredInvested ? formatMoney(totals.pnl) : "—"}
          </strong>
          <small>{formatPercent(totals.pnlPercent)}</small>
        </article>
        <article className="summary-card">
          <div className="summary-label"><span>CONCENTRATION</span></div>
          <strong>{(totals.hhi * 100).toFixed(0)}<span className="summary-total"> HHI</span></strong>
          <small>{totals.largest ? `largest ${totals.largest.symbol}` : "no verified positions"}</small>
        </article>
      </div>

      <form className="screen-form" onSubmit={addOrBuy}>
        <div className="screen-row">
          <label className="wide">
            <span>INSTRUMENT</span>
            <div className="inline-search">
              <InstrumentSearch
                compact
                onSelect={(instrument) => setDraft((current) => ({ ...current, instrument, avgCost: quotes[instrument.symbol]?.price ? String(quotes[instrument.symbol].price) : current.avgCost }))}
                placeholder={draft.instrument ? `${draft.instrument.symbol} · ${draft.instrument.exchange}` : "Search to add a holding"}
              />
            </div>
          </label>
          <label>
            <span>QUANTITY</span>
            <input type="number" step="any" value={draft.qty} onChange={(event) => setDraft({ ...draft, qty: event.target.value })} />
          </label>
          <label>
            <span>COST / UNIT</span>
            <input type="number" step="any" value={draft.avgCost} onChange={(event) => setDraft({ ...draft, avgCost: event.target.value })} />
          </label>
          <button type="submit" className="primary-action">Record virtual buy</button>
        </div>
      </form>

      <div className="lab-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="section-kicker">HOLDINGS</span>
              <h2>{rows.length} positions</h2>
            </div>
            <span className="chip muted">{failures.length} unmarked</span>
          </div>
          <div className="table-scroll">
            <table className="stocks-table">
              <thead>
                <tr>
                  <th>INSTRUMENT</th>
                  <th>QTY</th>
                  <th>AVG COST</th>
                  <th>LAST</th>
                  <th>VALUE</th>
                  <th>P&amp;L</th>
                  <th>WEIGHT</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button className="instrument-cell" type="button" onClick={() => onNavigate?.("charts", row)}>
                        <span className="ticker-icon">{row.symbol.slice(0, 2)}</span>
                        <span className="instrument-text">
                          <strong>{row.symbol}</strong>
                          <small>{row.name} · {row.sector}</small>
                        </span>
                      </button>
                    </td>
                    <td>{row.qty}</td>
                    <td>{formatMoney(row.avgCost, row.currency)}</td>
                    <td>{row.quote ? formatMoney(row.quote.price, row.quote.currency) : <span className="not-quoted">unverified</span>}</td>
                    <td>{row.value !== null ? formatMoney(row.value, row.currency) : "—"}</td>
                    <td>
                      {row.pnl !== null ? (
                        <span className={row.pnl >= 0 ? "positive-text" : "negative-text"}>
                          {formatMoney(row.pnl, row.currency)} ({formatPercent(row.pnlPercent)})
                        </span>
                      ) : (
                        <span className="not-quoted">—</span>
                      )}
                    </td>
                    <td>{totals.value && row.value !== null ? `${((row.value / totals.value) * 100).toFixed(1)}%` : "—"}</td>
                    <td>
                      <button type="button" className="text-action" onClick={() => sell(row)}>Sell</button>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr><td colSpan="8" className="table-empty">No virtual holdings yet.</td></tr>
                )}
              </tbody>
            </table>
            <div className="table-footer">
              <span>P&amp;L EXCLUDES UNVERIFIED POSITIONS</span>
              <span>NO BROKER CONNECTION · NO ORDER EXECUTION</span>
            </div>
          </div>
        </article>

        <aside className="lab-side">
          <article className="panel">
            <div className="panel-head compact">
              <h2>Sector exposure</h2>
            </div>
            <ul className="exposure-list">
              {sectorExposure.map((bucket) => (
                <li key={bucket.sector}>
                  <span>{bucket.sector}</span>
                  <div className="exposure-bar"><i style={{ width: `${bucket.weight}%` }} /></div>
                  <small>{bucket.weight.toFixed(1)}% · {bucket.count} pos</small>
                </li>
              ))}
              {!sectorExposure.length && <li className="muted-note">Add holdings to see exposure.</li>}
            </ul>
            <p className="muted-note">
              Unverified positions are valued at cost for exposure so a missing quote cannot distort the weights.
            </p>
          </article>

          <article className="panel">
            <div className="panel-head compact">
              <h2>Trade log</h2>
            </div>
            <ul className="trade-list">
              {trades.slice(0, 12).map((trade) => (
                <li key={trade.id}>
                  <span className={trade.side === "BUY" ? "positive-text" : "negative-text"}>{trade.side}</span>
                  <strong>{trade.qty} {trade.symbol}</strong>
                  <small>{trade.price ? formatMoney(trade.price) : "no verified price"} · {new Date(trade.at).toLocaleDateString("en-IN")}</small>
                </li>
              ))}
              {!trades.length && <li className="muted-note">No virtual trades recorded.</li>}
            </ul>
            <button
              type="button"
              className="text-action block-action"
              onClick={() => {
                if (!window.confirm("Clear all virtual holdings and trades in this browser?")) return;
                setHoldings([]);
                setTrades([]);
              }}
            >
              Reset virtual portfolio
            </button>
          </article>
        </aside>
      </div>
    </section>
  );
}
