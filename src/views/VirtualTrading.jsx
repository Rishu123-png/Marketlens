import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/terminal/Icon.jsx";
import TerminalPanel from "../components/terminal/TerminalPanel.jsx";
import InstrumentSearch from "../components/InstrumentSearch.jsx";
import PortfolioMetric from "../components/terminal/PortfolioMetric.jsx";
import PriceChange from "../components/terminal/PriceChange.jsx";
import DataStatus from "../components/terminal/DataStatus.jsx";
import EvidenceBadge from "../components/terminal/EvidenceBadge.jsx";
import EmptyState from "../components/terminal/EmptyState.jsx";
import MarketTable from "../components/terminal/MarketTable.jsx";
import VirtualOrderTable from "../components/terminal/VirtualOrderTable.jsx";
import { FEE_RATE, SLIPPAGE_RATE, STARTING_CASH, useVirtualAccount } from "../lib/useVirtualAccount.js";
import { api, formatMoney, formatTime } from "../lib/api.js";
import { numberOrNull, quoteState } from "../lib/marketVisuals.js";
import { verifiedQuoteForInstrument } from "../lib/virtualAccount.js";

function EquityCurve({ points }) {
  if (!points || points.length < 2) {
    return <EmptyState compact icon="trend" title="No simulated equity history" detail="The curve appears after at least one simulated fill and a marked refresh." />;
  }
  const values = points.map((point) => point.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 720;
  const height = 190;
  const coords = points.map((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - ((point.equity - min) / range) * (height - 20) - 10;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <div className="equity-chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Simulated account equity history">
        <defs>
          <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(35, 214, 157, .28)" />
            <stop offset="100%" stopColor="rgba(35, 214, 157, 0)" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((ratio) => <line key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} className="equity-grid" />)}
        <polygon points={`0,${height} ${coords.join(" ")} ${width},${height}`} fill="url(#equityFill)" />
        <polyline points={coords.join(" ")} fill="none" className="equity-line" />
      </svg>
      <div className="equity-axis"><span>{formatTime(points[0].at)}</span><span>{formatMoney(max)}</span><span>{formatTime(points.at(-1).at)}</span></div>
    </div>
  );
}

export default function VirtualTrading({ onNavigate }) {
  const { account, executeMarketOrder, placeLimitOrder, cancelOrder, recordEquity, reset } = useVirtualAccount();
  const [quotes, setQuotes] = useState({});
  const [failures, setFailures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState({ instrument: null, side: "BUY", qty: "10", orderType: "MARKET", limitPrice: "" });
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const ticketRequest = useRef(0);
  const ticketAbort = useRef(null);
  const marksRequest = useRef(0);

  const loadQuotes = useCallback(async ({ record = false, notify = false } = {}) => {
    const id = ++marksRequest.current;
    if (!account.positions.length) {
      setQuotes({});
      setFailures([]);
      setLoading(false);
      if (record) recordEquity(account.cash);
      if (notify) setNotice({ tone: "ok", message: "Simulated cash balance recorded in equity history." });
      return;
    }
    setLoading(true);
    try {
      const targets = account.positions.slice(0, 24).map((position) => `${position.symbol}@${position.exchange}`);
      const data = await api(`/api/quotes?symbols=${encodeURIComponent(targets.join(","))}`);
      if (marksRequest.current !== id) return;
      const map = Object.fromEntries((data.quotes || []).map((entry) => [
        `${entry.symbol}|${entry.quote?.exchange || entry.exchange || "NSE"}`,
        entry.quote
      ]));
      setQuotes(map);
      setFailures(data.failures || []);
      if (record) {
        const fullyMarked = account.positions.every((position) => verifiedQuoteForInstrument(map[`${position.symbol}|${position.exchange}`], position));
        if (fullyMarked) {
          const marked = account.positions.reduce((sum, position) => sum + position.qty * Number(map[`${position.symbol}|${position.exchange}`].price), account.cash);
          recordEquity(marked);
          if (notify) setNotice({ tone: "ok", message: "Simulated equity recorded using verified marks." });
        } else if (notify) {
          setNotice({ tone: "bad", message: "Equity history was not recorded: one or more positions lack a matching verified mark." });
        }
      }
    } catch (cause) {
      if (marksRequest.current !== id) return;
      setQuotes({});
      setFailures([{ message: cause.message }]);
      if (record && notify) setNotice({ tone: "bad", message: "Equity history was not recorded because marks could not be retrieved." });
    } finally {
      if (marksRequest.current === id) setLoading(false);
    }
  }, [account, recordEquity]);

  const positionsKey = account.positions.map((position) => `${position.symbol}@${position.exchange}:${position.qty}`).join(",");
  const latestOrder = account.orders[0];
  useEffect(() => {
    // React to the new account state, not the stale state captured before a fill.
    loadQuotes({ record: latestOrder?.status === "FILLED" });
    return () => { marksRequest.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionsKey, latestOrder?.id]);

  useEffect(() => () => {
    ticketRequest.current += 1;
    ticketAbort.current?.abort();
  }, []);

  function clearInstrument() {
    ticketRequest.current += 1;
    ticketAbort.current?.abort();
    setQuote(null);
    setQuoteError(null);
    setQuoteLoading(false);
    setDraft((current) => ({ ...current, instrument: null }));
  }

  async function chooseInstrument(instrument) {
    const id = ++ticketRequest.current;
    ticketAbort.current?.abort();
    const controller = new AbortController();
    ticketAbort.current = controller;
    setDraft((current) => ({ ...current, instrument }));
    setQuote(null);
    setQuoteError(null);
    setQuoteLoading(true);
    try {
      // /api/market returns the normalized quote directly.
      const data = await api(`/api/market?symbol=${encodeURIComponent(instrument.symbol)}&exchange=${encodeURIComponent(instrument.exchange || "")}`, { signal: controller.signal });
      if (ticketRequest.current !== id) return;
      if (verifiedQuoteForInstrument(data, instrument)) setQuote(data);
      else setQuoteError("No matching INR equity/ETF verified quote was returned.");
    } catch (cause) {
      if (ticketRequest.current === id) setQuoteError(cause.message || "No verified quote returned.");
    } finally {
      if (ticketRequest.current === id) setQuoteLoading(false);
    }
  }

  const rows = useMemo(() => account.positions.map((position) => {
    const candidate = quotes[`${position.symbol}|${position.exchange}`];
    const mark = verifiedQuoteForInstrument(candidate, position) ? candidate : null;
    const marketValue = mark ? position.qty * Number(mark.price) : null;
    const cost = position.qty * position.avgCost;
    return {
      ...position,
      mark,
      cost,
      marketValue,
      pnl: marketValue === null ? null : marketValue - cost,
      pnlPercent: marketValue === null || !cost ? null : ((marketValue - cost) / cost) * 100,
      dayPnl: mark && numberOrNull(mark.change) !== null ? Number(mark.change) * position.qty : null
    };
  }), [account.positions, quotes]);

  const totals = useMemo(() => {
    const marked = rows.filter((row) => row.marketValue !== null);
    const marketValue = marked.reduce((sum, row) => sum + row.marketValue, 0);
    const invested = rows.reduce((sum, row) => sum + row.cost, 0);
    const unmarked = rows.length - marked.length;
    const totalValue = account.cash + marketValue + rows.filter((row) => row.marketValue === null).reduce((sum, row) => sum + row.cost, 0);
    const pnl = unmarked ? null : totalValue - account.startingCash;
    const dayPnl = rows.length && rows.every((row) => row.dayPnl !== null) ? rows.reduce((sum, row) => sum + row.dayPnl, 0) : null;
    return { invested, totalValue, pnl, pnlPercent: pnl === null ? null : (pnl / account.startingCash) * 100, dayPnl, unmarked };
  }, [rows, account.cash, account.startingCash]);

  const selectedQuoteState = quoteState(quote);
  const selectedPrice = numberOrNull(quote?.price);
  const estimatedQty = Number(draft.qty) || 0;
  const estimatedPrice = draft.orderType === "LIMIT" ? Number(draft.limitPrice) || 0 : selectedPrice || 0;
  const estimatedNotional = estimatedQty * estimatedPrice;
  const estimatedFees = estimatedNotional * FEE_RATE;

  function submitOrder(event) {
    event.preventDefault();
    if (!draft.instrument) {
      setNotice({ tone: "bad", message: "Choose an instrument first." });
      return;
    }
    const result = draft.orderType === "LIMIT"
      ? placeLimitOrder({
          instrument: draft.instrument,
          side: draft.side,
          qty: draft.qty,
          limitPrice: draft.limitPrice,
          currency: quote?.currency || draft.instrument.currency || "INR"
        })
      : executeMarketOrder({ instrument: draft.instrument, side: draft.side, qty: draft.qty, quote });
    setNotice({ tone: result.ok ? "ok" : "bad", message: result.message });
    if (result.ok) {
      setDraft((current) => ({ ...current, qty: "10", limitPrice: "" }));
      // Marks and equity refresh after the updated account has rendered.
    }
  }

  const positionColumns = [
    {
      key: "symbol",
      label: "INSTRUMENT",
      value: (row) => row.symbol,
      render: (row) => <button type="button" className="table-instrument" onClick={() => onNavigate("markets", row)}><span>{row.symbol.slice(0, 2)}</span><div><strong>{row.symbol}</strong><small>{row.name} · {row.exchange}</small></div></button>
    },
    { key: "qty", label: "QTY", align: "right", value: (row) => row.qty, render: (row) => row.qty.toLocaleString("en-IN") },
    { key: "avgCost", label: "AVG COST", align: "right", value: (row) => row.avgCost, render: (row) => formatMoney(row.avgCost, row.currency) },
    { key: "price", label: "VERIFIED MARK", align: "right", value: (row) => row.mark?.price ?? null, render: (row) => row.mark ? formatMoney(row.mark.price, row.mark.currency) : <span className="muted">—</span> },
    { key: "markState", label: "MARK STATE", value: (row) => quoteState(row.mark).code, render: (row) => <DataStatus state={quoteState(row.mark)} compact /> },
    { key: "marketValue", label: "VALUE", align: "right", value: (row) => row.marketValue, render: (row) => row.marketValue === null ? "—" : formatMoney(row.marketValue, row.currency) },
    { key: "pnl", label: "P&L", align: "right", value: (row) => row.pnl, render: (row) => row.pnl === null ? <span className="muted">unmarked</span> : <PriceChange value={row.pnlPercent} percent size="sm" /> },
    {
      key: "actions",
      label: "",
      sortable: false,
      width: 120,
      render: (row) => (
        <div className="row-actions">
          <button type="button" onClick={() => onNavigate("research", row)}>Research</button>
          <button type="button" onClick={() => { setDraft({ instrument: row, side: "SELL", qty: String(row.qty), orderType: "MARKET", limitPrice: "" }); chooseInstrument(row); }}>Sell</button>
        </div>
      )
    }
  ];

  return (
    <section className="workspace trading-workspace">
      <header className="workspace-head">
        <div>
          <span className="workspace-kicker">VIRTUAL TRADING · PRACTICE & LEARN</span>
          <h1>Virtual Trading</h1>
          <p>Browser-local INR simulation for NSE/BSE equities and ETFs. Fills require a matching provider-verified quote; no order reaches a broker.</p>
        </div>
        <div className="workspace-head-actions">
          <span className="simulation-badge large"><i /> Simulation mode</span>
          <button type="button" className="t-btn secondary sm" onClick={() => loadQuotes({ record: true, notify: true })} disabled={loading}><Icon name="refresh" size={13} className={loading ? "spin" : ""} /> Mark to market</button>
          <button type="button" className="t-btn ghost sm" onClick={() => { if (window.confirm("Reset the simulated account to ₹10,00,000? Positions and orders will be cleared.")) { reset(); setNotice({ tone: "ok", message: "Simulated account reset." }); } }}>Reset</button>
        </div>
      </header>

      {notice && <div className={`inline-alert ${notice.tone === "bad" ? "error" : "info"}`} role="status"><Icon name={notice.tone === "bad" ? "warn" : "check"} size={15} /><div><strong>{notice.tone === "bad" ? "Simulation" : "Recorded"}</strong><span>{notice.message}</span></div></div>}
      {failures.length > 0 && <div className="inline-alert"><Icon name="warn" size={15} /><div><strong>Marks unavailable</strong><span>{failures.length} position(s) have no verified quote. They stay at cost and are excluded from P&L.</span></div></div>}

      <div className="portfolio-metrics-grid">
        <PortfolioMetric label="PORTFOLIO VALUE" value={formatMoney(totals.totalValue)} icon="briefcase" change={<PriceChange value={totals.pnlPercent} percent />} detail={totals.unmarked ? `${totals.unmarked} position(s) at cost` : "Cash + verified marks"} />
        <PortfolioMetric label="AVAILABLE CASH" value={formatMoney(account.cash)} icon="wallet" detail={`Started at ${formatMoney(STARTING_CASH)}`} />
        <PortfolioMetric label="INVESTED" value={formatMoney(totals.invested)} icon="layers" detail={`${account.positions.length} simulated position(s)`} />
        <PortfolioMetric label="TOTAL P&L" value={totals.pnl === null ? "—" : formatMoney(totals.pnl)} icon="trend" tone={totals.pnl > 0 ? "up" : totals.pnl < 0 ? "down" : "default"} change={totals.pnl !== null ? <PriceChange value={totals.pnlPercent} percent /> : null} detail={totals.unmarked ? "Unavailable until all positions are marked" : "Net account change, including fees"} />
        <PortfolioMetric label="DAY'S P&L" value={totals.dayPnl === null ? "—" : formatMoney(totals.dayPnl)} icon="clock" tone={(totals.dayPnl || 0) > 0 ? "up" : (totals.dayPnl || 0) < 0 ? "down" : "default"} change={<PriceChange value={totals.dayPnl} />} detail="From verified day change" />
      </div>

      <div className="trading-grid">
        <div className="trading-main">
          <TerminalPanel kicker="PERFORMANCE" title="Simulated equity curve" actions={<span className="panel-chip">Recorded when all positions are marked</span>} className="equity-panel">
            <EquityCurve points={account.equityHistory} />
          </TerminalPanel>

          <TerminalPanel kicker="POSITIONS" title="Simulated positions" actions={<span className="panel-chip">{account.positions.length} open</span>} className="positions-panel">
            <MarketTable columns={positionColumns} rows={rows} empty="No simulated positions. Place a market order when a verified quote is available." />
          </TerminalPanel>

          <TerminalPanel kicker="ORDER HISTORY" title="Simulated orders" actions={<span className="panel-chip">No broker execution</span>} className="orders-panel">
            <VirtualOrderTable orders={account.orders} onCancel={cancelOrder} />
          </TerminalPanel>
        </div>

        <aside className="trading-side">
          <TerminalPanel kicker="ORDER TICKET" title="Practice order" actions={<EvidenceBadge tone="unverified">Simulation only</EvidenceBadge>} className="order-ticket-panel">
            <form onSubmit={submitOrder} className="order-form">
              <div className="order-side-toggle">
                <button type="button" className={draft.side === "BUY" ? "active buy" : ""} onClick={() => setDraft({ ...draft, side: "BUY" })}>BUY</button>
                <button type="button" className={draft.side === "SELL" ? "active sell" : ""} onClick={() => setDraft({ ...draft, side: "SELL" })}>SELL</button>
              </div>
              <div className="field">
                <span>INSTRUMENT</span>
                {draft.instrument ? (
                  <button type="button" className="selected-instrument" onClick={clearInstrument}>
                    <span><strong>{draft.instrument.symbol}</strong><small>{draft.instrument.name} · {draft.instrument.exchange}</small></span>
                    <Icon name="x" size={12} />
                  </button>
                ) : <InstrumentSearch compact onSelect={chooseInstrument} placeholder="Search a catalogued instrument…" />}
              </div>
              {draft.instrument && (
                <div className="quote-preview">
                  <div><span>VERIFIED QUOTE</span><strong className={quote ? "" : "is-empty"}>{quote ? formatMoney(quote.price, quote.currency) : "—"}</strong></div>
                  <DataStatus state={selectedQuoteState} />
                  <small>{quote ? `${quote.source} · quote ${formatTime(quote.providerTimestamp)} · retrieved ${formatTime(quote.retrievedAt)}` : quoteLoading ? "Requesting a matching quote…" : quoteError || selectedQuoteState.detail}</small>
                </div>
              )}
              <div className="field-row">
                <label className="field"><span>QUANTITY</span><input type="number" min="1" step="1" value={draft.qty} onChange={(event) => setDraft({ ...draft, qty: event.target.value })} /></label>
                <label className="field"><span>ORDER TYPE</span><select value={draft.orderType} onChange={(event) => setDraft({ ...draft, orderType: event.target.value })}><option value="MARKET">Market</option><option value="LIMIT">Limit</option></select></label>
              </div>
              {draft.orderType === "LIMIT" && <label className="field"><span>LIMIT PRICE</span><input type="number" min="0" step="0.05" value={draft.limitPrice} onChange={(event) => setDraft({ ...draft, limitPrice: event.target.value })} placeholder="0.00" /></label>}
              <div className="order-estimate">
                <div><span>EST. NOTIONAL</span><strong>{estimatedNotional ? formatMoney(estimatedNotional) : "—"}</strong></div>
                <div><span>EST. FEES</span><strong>{estimatedFees ? formatMoney(estimatedFees) : "—"}</strong></div>
                <div><span>SLIPPAGE ASSUMPTION</span><strong>{(SLIPPAGE_RATE * 100).toFixed(2)}%</strong></div>
              </div>
              <button type="submit" className={`t-btn primary full ${draft.side === "SELL" ? "sell" : ""}`.trim()} disabled={!draft.instrument || (draft.orderType === "MARKET" && quoteLoading)}>
                <Icon name="send" size={12} /> {draft.orderType === "LIMIT" ? "Record limit order" : `Simulate ${draft.side}`}
              </button>
              <p className="order-disclaimer"><Icon name="shield" size={11} /> INR NSE/BSE equity/ETF only. Market fills use the displayed verified quote (which may be delayed or stale). Limits stay pending, do not reserve cash, and never auto-fill.</p>
            </form>
          </TerminalPanel>

          <TerminalPanel kicker="ASSUMPTIONS" title="Costs & controls" className="assumptions-panel">
            <div className="kv-list">
              <div><span>Brokerage / fees</span><strong>{(FEE_RATE * 100).toFixed(2)}% per side</strong></div>
              <div><span>Slippage</span><strong>{(SLIPPAGE_RATE * 100).toFixed(2)}% per side</strong></div>
              <div><span>Starting cash</span><strong>{formatMoney(STARTING_CASH)}</strong></div>
              <div><span>Broker connection</span><strong className="value-down">NONE</strong></div>
              <div><span>Real-money execution</span><strong className="value-down">DISABLED</strong></div>
              <div><span>Currency conversion</span><strong className="value-down">UNAVAILABLE</strong></div>
            </div>
            <p className="provenance-note">Assumptions are simplified for practice. They are not a model of exchange fees, taxes, STT, stamp duty or liquidity.</p>
          </TerminalPanel>

          <TerminalPanel kicker="RESEARCH LINKS" title="Attach evidence" className="trading-research-panel">
            {account.positions.length ? (
              <div className="research-link-list">
                {account.positions.slice(0, 4).map((position) => (
                  <button key={position.id} type="button" onClick={() => onNavigate("research", position)}>
                    <span><strong>{position.symbol}</strong><small>Open AI Analyst report</small></span>
                    <Icon name="arrowRight" size={12} />
                  </button>
                ))}
              </div>
            ) : <EmptyState compact icon="ai" title="No position to research" detail="Open AI Analyst independently to research an instrument before simulating." action={<button type="button" className="t-link" onClick={() => onNavigate("research")}>Open AI Analyst</button>} />}
          </TerminalPanel>
        </aside>
      </div>
    </section>
  );
}
