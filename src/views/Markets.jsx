import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/terminal/Icon.jsx";
import TerminalPanel from "../components/terminal/TerminalPanel.jsx";
import InstrumentHeader from "../components/terminal/InstrumentHeader.jsx";
import InstrumentSearch from "../components/InstrumentSearch.jsx";
import CandlestickChart from "../components/terminal/CandlestickChart.jsx";
import DataStatus from "../components/terminal/DataStatus.jsx";
import EvidenceBadge from "../components/terminal/EvidenceBadge.jsx";
import EmptyState from "../components/terminal/EmptyState.jsx";
import { useChartData } from "../lib/useChartData.js";
import { candleState, compactNumber, numberOrNull, preciseNumber, quoteState } from "../lib/marketVisuals.js";
import { formatTime } from "../lib/api.js";
import { defaultInstrument } from "../lib/instruments.js";

const TIMEFRAMES = [
  ["1min", "1m"], ["5min", "5m"], ["15min", "15m"], ["30min", "30m"],
  ["1h", "1H"], ["4h", "4H"], ["1day", "1D"], ["1week", "1W"], ["1month", "1M"]
];

const OVERLAYS = [
  ["sma20", "SMA 20", "#e3b25f"],
  ["sma50", "SMA 50", "#2f9bff"],
  ["sma200", "SMA 200", "#b77cff"],
  ["ema20", "EMA 20", "#28d7a1"],
  ["bb", "Bollinger Bands", "#607080"],
  ["vwap", "VWAP (anchored)", "#ff9164"]
];

const INDICATOR_ROWS = [
  ["RSI 14", (value) => value?.rsi],
  ["MACD", (value) => value?.macd?.line],
  ["MACD signal", (value) => value?.macd?.signal],
  ["SMA 20", (value) => value?.movingAverages?.sma20],
  ["SMA 50", (value) => value?.movingAverages?.sma50],
  ["SMA 200", (value) => value?.movingAverages?.sma200],
  ["EMA 9", (value) => value?.movingAverages?.ema9],
  ["ATR 14", (value) => value?.atr],
  ["Bollinger upper", (value) => value?.bollinger?.upper],
  ["Bollinger lower", (value) => value?.bollinger?.lower],
  ["Relative volume", (value) => value?.relativeVolume]
];

function useChartHeight() {
  const [height, setHeight] = useState(() => Math.max(300, Math.min(600, window.innerHeight - 470)));
  useEffect(() => {
    function resize() {
      setHeight(Math.max(280, Math.min(600, window.innerHeight - 470)));
    }
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return height;
}

export default function Markets({ focus, onNavigate, defaultExchange = "NSE" }) {
  const initial = focus?.symbol
    ? { ...focus, exchange: focus.exchange || defaultExchange, name: focus.name || focus.symbol }
    : defaultInstrument(defaultExchange);
  const chart = useChartData({ initialSymbol: initial.symbol, initialExchange: initial.exchange, initialName: initial.name, initialInterval: "1day", limit: 320 });
  const [mode, setMode] = useState("candles");
  const [enabled, setEnabled] = useState(() => new Set(["ema20", "sma50"]));
  const [showVolume, setShowVolume] = useState(true);
  const [showPivots, setShowPivots] = useState(true);
  const [showFib, setShowFib] = useState(false);
  const panelRef = useRef(null);
  const chartHeight = useChartHeight();

  const overlays = useMemo(() => {
    if (!chart.analysis?.series) return [];
    return OVERLAYS.flatMap(([id, label, color]) => {
      if (!enabled.has(id)) return [];
      if (id === "bb") {
        return [
          { label: "BB upper", color, data: chart.analysis.series.bbUpper },
          { label: "BB lower", color, data: chart.analysis.series.bbLower }
        ];
      }
      return [{ label, color, data: chart.analysis.series[id] }];
    }).filter((overlay) => overlay.data?.length);
  }, [chart.analysis, enabled]);

  const levels = useMemo(() => {
    const zones = (chart.analysis?.chart?.supportResistance || []).slice(0, 4).map((zone) => ({
      price: (zone.low + zone.high) / 2,
      title: `${zone.kind} ${zone.touches}t`,
      color: zone.kind === "support" ? "#25896a" : "#9b3d47"
    }));
    if (!showFib) return zones;
    const highs = (chart.analysis?.chart?.pivots?.highs || []).slice(-3);
    const lows = (chart.analysis?.chart?.pivots?.lows || []).slice(-3);
    if (!highs.length || !lows.length) return zones;
    const high = Math.max(...highs.map((pivot) => pivot.price));
    const low = Math.min(...lows.map((pivot) => pivot.price));
    if (!(high > low)) return zones;
    for (const ratio of [0.236, 0.382, 0.5, 0.618, 0.786]) {
      zones.push({ price: high - (high - low) * ratio, title: `fib ${(ratio * 100).toFixed(1)}%`, color: "#536a7d" });
    }
    return zones;
  }, [chart.analysis, showFib]);

  const trendlines = useMemo(() => {
    if (!showPivots) return [];
    const pivots = chart.analysis?.chart?.pivots;
    const lines = [];
    for (const [key, color] of [["highs", "#9b3d47"], ["lows", "#25896a"]]) {
      const points = (pivots?.[key] || []).slice(-2);
      if (points.length !== 2) continue;
      lines.push({
        from: { time: points[0].time, value: points[0].price },
        to: { time: points[1].time, value: points[1].price },
        color,
        label: key === "highs" ? "pivot highs" : "pivot lows"
      });
    }
    return lines;
  }, [chart.analysis, showPivots]);

  const chartData = chart.analysis?.chart;
  const indicators = chart.analysis?.indicators;
  const dataState = candleState(chart.analysis);
  const quoteDataState = quoteState(chart.quote);

  function toggleOverlay(id) {
    setEnabled((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function changeExchange(exchange) {
    chart.chooseInstrument({ symbol: chart.instrument.symbol, name: chart.instrument.symbol, exchange });
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await panelRef.current?.requestFullscreen();
    } catch {
      /* Browsers can deny fullscreen; the chart remains usable. */
    }
  }

  return (
    <section className="workspace markets-workspace">
      <header className="workspace-head markets-head">
        <div>
          <span className="workspace-kicker">MARKETS · PRICE STRUCTURE</span>
          <h1>Markets</h1>
          <p>Server-calculated candles and indicators. Loading this screen never calls an AI model.</p>
        </div>
        <div className="workspace-head-actions">
          <div className="exchange-select">
            <span>EXCHANGE</span>
            <select value={chart.instrument.exchange || "NSE"} onChange={(event) => changeExchange(event.target.value)}>
              {["NSE", "BSE", "NASDAQ", "NYSE"].map((exchange) => <option key={exchange}>{exchange}</option>)}
            </select>
          </div>
          <div className="instrument-search-wrap"><InstrumentSearch compact onSelect={chart.chooseInstrument} placeholder="Switch instrument…" /></div>
          <button type="button" className="t-btn secondary sm" onClick={chart.refresh} disabled={chart.loading}>
            <Icon name="refresh" size={13} className={chart.loading ? "spin" : ""} /> Refresh
          </button>
        </div>
      </header>

      <div className="markets-grid">
        <div className="markets-main" ref={panelRef}>
          <TerminalPanel className="markets-chart-panel" bodyClassName="chart-panel-body">
            <InstrumentHeader
              instrument={chart.instrument}
              quote={chart.quote}
              quoteError={chart.quoteError}
              compact
              actions={
                <div className="chart-head-actions">
                  <DataStatus state={dataState} />
                  <button type="button" className="square-btn" onClick={toggleFullscreen} aria-label="Toggle chart fullscreen"><Icon name="expand" size={14} /></button>
                </div>
              }
            />

            <div className="chart-toolbar">
              <div className="timeframe-group" role="group" aria-label="Chart timeframe">
                {TIMEFRAMES.map(([value, label]) => (
                  <button key={value} type="button" className={chart.interval === value ? "active" : ""} onClick={() => chart.chooseInterval(value)}>{label}</button>
                ))}
              </div>
              <span className="toolbar-separator" />
              <div className="chart-type-group" role="group" aria-label="Chart display">
                <button type="button" className={mode === "candles" ? "active" : ""} onClick={() => setMode("candles")} title="Candlesticks"><Icon name="candle" size={14} /></button>
                <button type="button" className={mode === "line" ? "active" : ""} onClick={() => setMode("line")} title="Line"><Icon name="line" size={14} /></button>
                <button type="button" className={mode === "ohlc" ? "active" : ""} onClick={() => setMode("ohlc")} title="OHLC bars"><Icon name="volume" size={14} /></button>
              </div>
              <span className="toolbar-separator" />
              <details className="menu-popover">
                <summary><Icon name="indicators" size={14} /> Indicators <Icon name="chevronDown" size={11} /></summary>
                <div className="menu-panel">
                  <span className="menu-label">PRICE OVERLAYS</span>
                  {OVERLAYS.map(([id, label]) => (
                    <label key={id} className="check-row">
                      <input type="checkbox" checked={enabled.has(id)} onChange={() => toggleOverlay(id)} />
                      <span>{label}</span>
                    </label>
                  ))}
                  <span className="menu-label">CHART</span>
                  <label className="check-row"><input type="checkbox" checked={showVolume} onChange={() => setShowVolume((value) => !value)} /><span>Volume</span></label>
                  <span className="menu-label">STRUCTURE</span>
                  <label className="check-row"><input type="checkbox" checked={showPivots} onChange={() => setShowPivots((value) => !value)} /><span>Pivot trendlines</span></label>
                  <label className="check-row"><input type="checkbox" checked={showFib} onChange={() => setShowFib((value) => !value)} /><span>Fibonacci levels</span></label>
                </div>
              </details>
              <div className="chart-legend">
                {[...enabled].slice(0, 3).map((id) => {
                  const overlay = OVERLAYS.find(([key]) => key === id);
                  return overlay ? <span key={id}><i style={{ background: overlay[2] }} />{overlay[1]}</span> : null;
                })}
                {showVolume && <span><i className="volume-colour" />Volume</span>}
              </div>
              <span className="chart-live-state"><DataStatus state={quoteDataState} compact /></span>
            </div>

            <CandlestickChart
              analysis={chart.analysis}
              loading={chart.loading}
              error={chart.error}
              mode={mode}
              showVolume={showVolume}
              overlays={overlays}
              levels={levels}
              trendlines={trendlines}
              height={chartHeight}
              emptyTitle="No verified history for this selection"
              emptyDetail={`${chart.instrument.symbol} · ${chart.interval}. ${chart.error?.message || "No provider returned candles."} Nothing is simulated.`}
              onCoverage={() => onNavigate("coverage")}
            />

            <div className="chart-bottom-bar">
              <span><EvidenceBadge tone="historical">{dataState.label}</EvidenceBadge> {chart.analysis?.source || "provider pending"}</span>
              <span>{chart.analysis?.coverage?.from || "—"} → {chart.analysis?.coverage?.to || "—"}</span>
              <span>{chart.analysis?.coverage?.count ?? 0} candles · dropped {chart.analysis?.droppedRows ?? 0}</span>
              <span>Indicator engine v{chart.analysis?.versions?.indicators || "—"}</span>
              <span>Retrieved {formatTime(chart.analysis?.retrievedAt)}</span>
            </div>
            {chart.warning && <div className="inline-note warn">{chart.warning}</div>}
          </TerminalPanel>
        </div>

        <aside className="markets-side">
          <TerminalPanel kicker="MARKET STRUCTURE" title="Structure & levels" className="market-structure-panel">
            {chartData ? (
              <>
                <div className="structure-hero">
                  <div><span>TREND</span><strong className={`trend-label ${chartData.trend?.label || ""}`}>{chartData.trend?.label?.replaceAll("-", " ").toUpperCase() || "—"}</strong></div>
                  <div><span>LAST CLOSE</span><strong>{preciseNumber(chartData.lastClose)}</strong></div>
                  <div><span>CANDLES</span><strong>{chartData.candles ?? "—"}</strong></div>
                  <div><span>RSI</span><strong>{preciseNumber(indicators?.rsi)}</strong></div>
                </div>
                <h3>Support / resistance</h3>
                {chartData.supportResistance?.length ? (
                  <ul className="zone-list">
                    {chartData.supportResistance.slice(0, 6).map((zone, index) => (
                      <li key={index}>
                        <span className={`zone-kind ${zone.kind}`}>{zone.kind}</span>
                        <strong>{preciseNumber(zone.low)} – {preciseNumber(zone.high)}</strong>
                        <small>{zone.touches} touches</small>
                      </li>
                    ))}
                  </ul>
                ) : <p className="inline-note">No repeated pivot clusters in this window.</p>}
                <h3>Detected patterns</h3>
                {chartData.chartPatterns?.length || chartData.candlestickPatterns?.length ? (
                  <ul className="pattern-list">
                    {(chartData.chartPatterns || []).map((pattern, index) => (
                      <li key={`chart-${index}`}><span>{pattern.name}</span><b className={`pattern-${pattern.status}`}>{pattern.status}</b><small>{pattern.confidence}</small></li>
                    ))}
                    {(chartData.candlestickPatterns || []).slice(0, 5).map((pattern, index) => (
                      <li key={`candle-${index}`}><span>{pattern.name}</span><b>latest</b><small>{pattern.direction}</small></li>
                    ))}
                  </ul>
                ) : <p className="inline-note">No chart patterns detected on the latest candles.</p>}
              </>
            ) : (
              <EmptyState compact icon="layers" title="Structure unavailable" detail="Structure is calculated only when verified candles load." />
            )}
          </TerminalPanel>

          <TerminalPanel kicker="DETERMINISTIC INDICATORS" title="Indicator matrix" className="indicator-panel">
            {indicators ? (
              <div className="indicator-grid">
                {INDICATOR_ROWS.map(([label, read]) => (
                  <div key={label}><span>{label}</span><strong>{preciseNumber(read(indicators))}</strong></div>
                ))}
              </div>
            ) : <p className="inline-note">Indicators arrive with the candle response. Long-period averages show “—” when history is short.</p>}
          </TerminalPanel>

          <TerminalPanel kicker="DATA QUALITY" title="Provenance" className="provenance-panel">
            <div className="kv-list">
              <div><span>Quote state</span><DataStatus state={quoteDataState} compact /></div>
              <div><span>Candle state</span><DataStatus state={dataState} compact /></div>
              <div><span>Quote source</span><strong>{chart.quote?.source || chart.quote?.provider || "—"}</strong></div>
              <div><span>Candle source</span><strong>{chart.analysis?.source || "—"}</strong></div>
              <div><span>Provider timestamp</span><strong>{formatTime(chart.quote?.providerTimestamp)}</strong></div>
              <div><span>Retrieved</span><strong>{formatTime(chart.analysis?.retrievedAt)}</strong></div>
              <div><span>Rows dropped</span><strong>{chart.analysis?.droppedRows ?? 0}</strong></div>
              <div><span>Cache hit</span><strong>{chart.analysis?.cached ? "yes" : "no"}</strong></div>
            </div>
            <p className="provenance-note"><Icon name="shield" size={12} /> Raw provider URLs, API keys and headers are never exposed.</p>
            <button type="button" className="t-btn secondary full" onClick={() => onNavigate("coverage")}>Open market data coverage</button>
          </TerminalPanel>
        </aside>
      </div>
    </section>
  );
}
