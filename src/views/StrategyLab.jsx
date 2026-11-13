import { useMemo, useState } from "react";
import Icon from "../components/terminal/Icon.jsx";
import TerminalPanel from "../components/terminal/TerminalPanel.jsx";
import InstrumentSearch from "../components/InstrumentSearch.jsx";
import EmptyState from "../components/terminal/EmptyState.jsx";
import MarketTable from "../components/terminal/MarketTable.jsx";
import PriceChange from "../components/terminal/PriceChange.jsx";
import EvidenceBadge from "../components/terminal/EvidenceBadge.jsx";
import DataStatus from "../components/terminal/DataStatus.jsx";
import { api, formatMoney, formatPercent, formatTime } from "../lib/api.js";
import { backtest, computeSignals } from "../lib/backtest.js";
import { defaultInstrument } from "../lib/instruments.js";

const STRATEGIES = {
  sma: { label: "SMA crossover", detail: "Long when fast SMA is above slow SMA; cash otherwise." },
  rsi: { label: "RSI mean reversion", detail: "Long when RSI is at or below the entry level; exit at or above the exit level." },
  breakout: { label: "Donchian breakout", detail: "Long on a close above the prior N-day high; exit on a close below the N-day low." }
};

function EquityComparison({ equity, benchmark }) {
  if (!equity || equity.length < 2) {
    return <EmptyState compact icon="strategy" title="No backtest curve" detail="Run a strategy with verified candles to generate a deterministic equity curve." />;
  }
  const all = [...equity.map((point) => point.value), ...benchmark.map((point) => point.value)];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;
  const width = 900;
  const height = 270;
  const coords = (points) => points.map((point, index) => {
    const x = (index / Math.max(points.length - 1, 1)) * width;
    const y = height - ((point.value - min) / range) * (height - 22) - 10;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <div className="strategy-chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Strategy and benchmark equity curves">
        {[0.25, 0.5, 0.75].map((ratio) => <line key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} className="equity-grid" />)}
        <polyline points={coords(benchmark)} fill="none" className="benchmark-line" />
        <polyline points={coords(equity)} fill="none" className="strategy-line" />
      </svg>
      <div className="strategy-legend"><span><i className="strategy-line-key" />Strategy</span><span><i className="benchmark-line-key" />Buy &amp; hold benchmark</span><span>{benchmark.length} observations</span></div>
    </div>
  );
}

export default function StrategyLab({ onNavigate, defaultExchange = "NSE" }) {
  const [instrument, setInstrument] = useState(() => defaultInstrument(defaultExchange));
  const [interval, setIntervalValue] = useState("1day");
  const [strategy, setStrategy] = useState("sma");
  const [params, setParams] = useState({ fast: "20", slow: "50", rsiEntry: "30", rsiExit: "55", lookback: "20" });
  const [capital, setCapital] = useState("100000");
  const [feeRate, setFeeRate] = useState("0.05");
  const [slippageRate, setSlippageRate] = useState("0.05");
  const [analysis, setAnalysis] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function run(event) {
    event?.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setAnalysis(null);
    try {
      const startingCapital = Number(capital);
      const feePercent = Number(feeRate);
      const slippagePercent = Number(slippageRate);
      if (!capital.trim() || !(startingCapital >= 1000) || !feeRate.trim() || !slippageRate.trim() || feePercent < 0 || feePercent >= 100 || slippagePercent < 0 || slippagePercent >= 100 || !Number.isFinite(startingCapital) || !Number.isFinite(feePercent) || !Number.isFinite(slippagePercent)) {
        throw new Error("Capital must be at least 1,000; fee and slippage must each be between 0% and 100% (exclusive).");
      }
      const payload = await api(`/api/analysis?symbol=${encodeURIComponent(instrument.symbol)}&exchange=${encodeURIComponent(instrument.exchange || "")}&interval=${encodeURIComponent(interval)}&limit=520`);
      setAnalysis(payload);
      const candles = payload?.candles || [];
      if (candles.length < 30) {
        throw new Error(`Only ${candles.length} verified candles were returned; the strategy needs at least 30.`);
      }
      const targets = computeSignals(candles, {
        strategy,
        fast: params.fast,
        slow: params.slow,
        rsiEntry: params.rsiEntry,
        rsiExit: params.rsiExit,
        lookback: params.lookback,
        rsiSeries: payload?.series?.rsi14 || []
      });
      const tested = backtest(candles, targets, {
        startingCapital,
        feeRate: feePercent / 100,
        slippageRate: slippagePercent / 100
      });
      setResult({ ...tested, candles, targets, instrument: { ...instrument }, interval, strategy, startingCapital, currency: instrument.currency || (instrument.exchange === "NSE" || instrument.exchange === "BSE" ? "INR" : "USD"), generatedAt: new Date().toISOString() });
    } catch (cause) {
      setError(cause.message || "Backtest failed.");
    } finally {
      setLoading(false);
    }
  }

  const trades = useMemo(() => [...(result?.trades || [])].reverse().map((trade, index) => ({ ...trade, id: `trade-${index}` })), [result]);
  const tradeColumns = [
    { key: "entryAt", label: "ENTRY", value: (row) => row.entryAt, render: (row) => formatTime(row.entryAt) },
    { key: "exitAt", label: "EXIT", value: (row) => row.exitAt, render: (row) => formatTime(row.exitAt) },
    { key: "entryCost", label: "CAPITAL", align: "right", value: (row) => row.entryCost, render: (row) => formatMoney(row.entryCost, result?.currency) },
    { key: "proceeds", label: "PROCEEDS", align: "right", value: (row) => row.proceeds, render: (row) => formatMoney(row.proceeds, result?.currency) },
    { key: "pnl", label: "P&L", align: "right", value: (row) => row.pnl, render: (row) => <PriceChange value={row.pnl} /> },
    { key: "returnPercent", label: "RETURN", align: "right", value: (row) => row.returnPercent, render: (row) => <PriceChange value={row.returnPercent} percent /> }
  ];

  return (
    <section className="workspace strategy-workspace">
      <header className="workspace-head">
        <div>
          <span className="workspace-kicker">STRATEGY LAB · DETERMINISTIC BACKTEST</span>
          <h1>Strategy Lab</h1>
          <p>Historical arithmetic on provider-verified candles. No model, no forecast, no parameter search on future data.</p>
        </div>
        <div className="workspace-head-actions">
          <EvidenceBadge tone="historical">Historical simulation</EvidenceBadge>
          <button type="button" className="t-btn primary sm" onClick={run} disabled={loading}><Icon name={loading ? "refresh" : "play"} size={12} className={loading ? "spin" : ""} /> {loading ? "Running…" : "Run backtest"}</button>
        </div>
      </header>

      <div className="strategy-grid">
        <div className="strategy-main">
          <TerminalPanel kicker="STRATEGY BUILDER" title="Parameters" className="strategy-builder">
            <form onSubmit={run} className="strategy-form">
              <label className="field"><span>INSTRUMENT</span><div className="selected-instrument static"><span><strong>{instrument.symbol}</strong><small>{instrument.name} · {instrument.exchange}</small></span></div></label>
              <label className="field"><span>SEARCH</span><InstrumentSearch compact onSelect={setInstrument} placeholder="Switch instrument…" /></label>
              <label className="field"><span>EXCHANGE</span><select value={instrument.exchange} onChange={(event) => setInstrument({ symbol: instrument.symbol, name: instrument.symbol, exchange: event.target.value, currency: ["NSE", "BSE"].includes(event.target.value) ? "INR" : "USD" })}>{["NSE", "BSE", "NASDAQ", "NYSE"].map((exchange) => <option key={exchange}>{exchange}</option>)}</select></label>
              <label className="field"><span>TIMEFRAME</span><select value={interval} onChange={(event) => setIntervalValue(event.target.value)}><option value="1day">Daily</option><option value="1week">Weekly</option></select></label>
              <label className="field wide"><span>STRATEGY</span><select value={strategy} onChange={(event) => setStrategy(event.target.value)}>{Object.entries(STRATEGIES).map(([id, meta]) => <option key={id} value={id}>{meta.label}</option>)}</select><small>{STRATEGIES[strategy].detail}</small></label>
              {strategy === "sma" && <><label className="field"><span>FAST SMA</span><input type="number" min="2" value={params.fast} onChange={(event) => setParams({ ...params, fast: event.target.value })} /></label><label className="field"><span>SLOW SMA</span><input type="number" min="3" value={params.slow} onChange={(event) => setParams({ ...params, slow: event.target.value })} /></label></>}
              {strategy === "rsi" && <><label className="field"><span>RSI ENTRY</span><input type="number" min="1" max="100" value={params.rsiEntry} onChange={(event) => setParams({ ...params, rsiEntry: event.target.value })} /></label><label className="field"><span>RSI EXIT</span><input type="number" min="1" max="100" value={params.rsiExit} onChange={(event) => setParams({ ...params, rsiExit: event.target.value })} /></label></>}
              {strategy === "breakout" && <label className="field"><span>LOOKBACK</span><input type="number" min="5" value={params.lookback} onChange={(event) => setParams({ ...params, lookback: event.target.value })} /></label>}
              <label className="field"><span>STARTING CAPITAL · INSTRUMENT CURRENCY</span><input type="number" min="1000" value={capital} onChange={(event) => setCapital(event.target.value)} /></label>
              <label className="field"><span>FEE % / SIDE</span><input type="number" min="0" max="99.99" step="0.01" value={feeRate} onChange={(event) => setFeeRate(event.target.value)} /></label>
              <label className="field"><span>SLIPPAGE % / SIDE</span><input type="number" min="0" max="99.99" step="0.01" value={slippageRate} onChange={(event) => setSlippageRate(event.target.value)} /></label>
              <button type="submit" className="t-btn primary wide" disabled={loading}><Icon name="play" size={12} /> Run deterministic test</button>
            </form>
          </TerminalPanel>

          <TerminalPanel kicker="EQUITY" title="Strategy vs benchmark" actions={result ? <span className="panel-chip">{result.candles.length} candles · {formatTime(result.generatedAt)}</span> : null} className="strategy-equity-panel">
            {error && <div className="inline-alert error"><Icon name="warn" size={14} /><div><strong>Backtest unavailable</strong><span>{error}</span></div></div>}
            {!result && !loading && <EmptyState icon="strategy" title="No backtest has been run" detail="Choose a strategy and run it. Results are based only on verified candles returned by the server." action={<button type="button" className="t-btn secondary sm" onClick={run}>Run backtest</button>} />}
            {loading && <div className="panel-loading"><span className="loader-ring" /> Requesting candles and computing the test…</div>}
            {result && <><EquityComparison equity={result.equity} benchmark={result.benchmark} /><p className="provenance-note">Results reflect the last run ({STRATEGIES[result.strategy].label}, {result.instrument.symbol} · {result.interval}). Rerun after changing parameters.</p></>}
          </TerminalPanel>

          <TerminalPanel kicker="TRADES" title="Round-trip log" actions={result ? <span className="panel-chip">{result.trades.length} closed trades</span> : null} className="strategy-trades-panel">
            <MarketTable columns={tradeColumns} rows={trades} empty="No round-trip trades were generated by this parameter set." />
          </TerminalPanel>
        </div>

        <aside className="strategy-side">
          <TerminalPanel kicker="RESULT" title="Performance" className="strategy-metrics-panel">
            {result ? (
              <div className="strategy-metric-grid">
                <div><span>TOTAL RETURN</span><strong className={result.totalReturn >= 0 ? "value-up" : "value-down"}>{formatPercent(result.totalReturn)}</strong></div>
                <div><span>BENCHMARK</span><strong className={result.benchmarkReturn >= 0 ? "value-up" : "value-down"}>{result.benchmarkReturn === null ? "—" : formatPercent(result.benchmarkReturn)}</strong></div>
                <div><span>FINAL EQUITY</span><strong>{formatMoney(result.finalEquity, result.currency)}</strong></div>
                <div><span>MAX DRAWDOWN</span><strong className="value-down">{result.maxDrawdown === null ? "—" : formatPercent(result.maxDrawdown)}</strong></div>
                <div><span>WIN RATE</span><strong>{result.winRate === null ? "—" : formatPercent(result.winRate)}</strong></div>
                <div><span>EXPOSURE</span><strong>{formatPercent(result.exposure)}</strong></div>
                <div><span>TRADES</span><strong>{result.trades.length}</strong></div>
                <div><span>STARTING CAPITAL · INSTRUMENT CURRENCY</span><strong>{formatMoney(result.startingCapital, result.currency)}</strong></div>
              </div>
            ) : <EmptyState compact icon="trend" title="Metrics pending" detail="Run the strategy to compute return, drawdown and benchmark comparison." />}
          </TerminalPanel>

          <TerminalPanel kicker="DATA USED" title="Provenance" className="strategy-provenance">
            <div className="kv-list">
              <div><span>Instrument</span><strong>{result ? `${result.instrument.symbol} · ${result.instrument.exchange}` : "—"}</strong></div>
              <div><span>Timeframe</span><strong>{result?.interval || "—"}</strong></div>
              <div><span>Candles</span><strong>{analysis?.candles?.length ?? 0}</strong></div>
              <div><span>Source</span><strong>{analysis?.source || "—"}</strong></div>
              <div><span>Indicator engine</span><strong>v{analysis?.versions?.indicators || "—"}</strong></div>
              <div><span>Data state</span><DataStatus state={{ code: analysis?.candles?.length ? "historical" : "unavailable", label: analysis?.candles?.length ? "HISTORICAL" : "UNAVAILABLE" }} compact /></div>
            </div>
            <button type="button" className="t-btn secondary full" onClick={() => onNavigate("coverage")}>Check data coverage</button>
          </TerminalPanel>

          <TerminalPanel kicker="LIMITATIONS" title="Read before using" className="strategy-limitations">
            <ul className="limitation-list">
              <li>Signals use only information available up to each candle; the engine does not search future data.</li>
              <li>Fractional units are assumed; remaining positions close at the final candle. The buy-and-hold benchmark is frictionless.</li>
              <li>Fees and slippage are simplified percentages. Taxes, STT, stamp duty and liquidity are excluded.</li>
              <li>Results use the provider's adjusted/unadjusted candles exactly as returned; corporate-action treatment is not inferred.</li>
              <li>No parameter optimisation, walk-forward validation or statistical significance claim is made.</li>
              <li>Historical success is not a forecast and is not investment advice.</li>
            </ul>
          </TerminalPanel>
        </aside>
      </div>
    </section>
  );
}
