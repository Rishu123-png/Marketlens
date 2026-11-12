import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CoverageBar from "../components/CoverageBar.jsx";
import InstrumentSearch from "../components/InstrumentSearch.jsx";
import IndicatorPane from "../components/IndicatorPane.jsx";
import PriceChart from "../components/PriceChart.jsx";
import { formatMoney, formatPercent, formatTime } from "../lib/api.js";
import { fetchChartData } from "../lib/chartData.js";

const TIMEFRAMES = [
  ["1min", "1m"],
  ["5min", "5m"],
  ["15min", "15m"],
  ["30min", "30m"],
  ["1h", "1H"],
  ["4h", "4H"],
  ["1day", "1D"],
  ["1week", "1W"],
  ["1month", "1M"]
];

const OVERLAYS = [
  ["sma20", "SMA 20", "#e9bd68"],
  ["sma50", "SMA 50", "#79b7ff"],
  ["sma200", "SMA 200", "#c98cff"],
  ["ema20", "EMA 20", "#39d19a"],
  ["bb", "Bollinger", "#65737e"],
  ["vwap", "VWAP (anchored)", "#ff9f6e"]
];

const INDICATOR_ROWS = [
  ["RSI 14", (i) => i?.rsi],
  ["MACD", (i) => i?.macd?.line],
  ["MACD signal", (i) => i?.macd?.signal],
  ["SMA 20", (i) => i?.movingAverages?.sma20],
  ["SMA 50", (i) => i?.movingAverages?.sma50],
  ["SMA 200", (i) => i?.movingAverages?.sma200],
  ["EMA 9", (i) => i?.movingAverages?.ema9],
  ["ATR 14", (i) => i?.atr],
  ["Bollinger upper", (i) => i?.bollinger?.upper],
  ["Bollinger lower", (i) => i?.bollinger?.lower],
  ["Relative volume", (i) => i?.relativeVolume]
];

function number(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return Number(value).toFixed(digits);
}

function compactVolume(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value));
}

export default function ChartLab({ initialSymbol = "RELIANCE", onNavigate }) {
  const [instrument, setInstrument] = useState({ symbol: initialSymbol, exchange: "NSE", name: "Reliance Industries Ltd", currency: "INR" });
  const [interval, setInterval] = useState("1day");
  const [mode, setMode] = useState("candles");
  const [enabled, setEnabled] = useState(() => new Set(["sma20", "ema20"]));
  const [showPivots, setShowPivots] = useState(true);
  const [showFib, setShowFib] = useState(false);
  const [panes, setPanes] = useState("rsi");
  const [analysis, setAnalysis] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [analysisWarning, setAnalysisWarning] = useState(null);
  const requestRef = useRef(0);
  const abortRef = useRef(null);
  const loadedKeyRef = useRef(null);

  /**
   * One explicit request path for instrument/timeframe changes.
   *
   * - `/api/history` is the canonical candle request; `/api/analysis` adds
   *   indicator series and chart structure (the server reuses its candle cache).
   * - A monotonically increasing request id prevents a slow earlier response
   *   from overwriting a newer selection.
   * - An AbortController cancels superseded requests.
   * - `loadedKeyRef` suppresses duplicate fetches for the same selection caused
   *   by re-renders; the Refresh button deliberately bypasses it.
   */
  const load = useCallback(
    async (target = instrument, timeframe = interval, { force = false } = {}) => {
      if (!target?.symbol) return;
      const key = `${target.symbol}|${target.exchange || "NSE"}|${timeframe}`;
      if (!force && loadedKeyRef.current === key) return;

      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);
      setAnalysisWarning(null);
      setQuoteError(null);

      try {
        const result = await fetchChartData({
          symbol: target.symbol,
          exchange: target.exchange || "",
          interval: timeframe,
          limit: 320,
          signal: controller.signal
        });

        if (requestRef.current !== requestId) return;

        setQuote(result.quote);
        setQuoteError(result.quoteError);

        if (result.analysis) {
          setAnalysis(result.analysis);
          setError(null);
          setAnalysisWarning(result.analysisWarning);
          loadedKeyRef.current = key;
        } else {
          setAnalysis(null);
          setError(result.error);
        }
      } catch (cause) {
        if (requestRef.current !== requestId) return;
        setAnalysis(null);
        setError({ message: cause?.message || "Chart request failed.", status: cause?.status });
      } finally {
        if (requestRef.current === requestId) setLoading(false);
      }
    },
    [instrument, interval]
  );

  useEffect(() => {
    load({ symbol: initialSymbol, exchange: "NSE", name: initialSymbol, currency: "INR" }, "1day");
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function chooseInstrument(next) {
    setInstrument(next);
    load(next, interval, { force: true });
  }

  function chooseInterval(next) {
    setInterval(next);
    load(instrument, next, { force: true });
  }

  function toggleOverlay(id) {
    setEnabled((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const overlays = useMemo(() => {
    if (!analysis?.series) return [];
    const list = [];
    for (const [id, label, color] of OVERLAYS) {
      if (!enabled.has(id)) continue;
      if (id === "bb") {
        list.push({ label: "BB upper", color, data: analysis.series.bbUpper });
        list.push({ label: "BB lower", color, data: analysis.series.bbLower });
      } else {
        list.push({ label, color, data: analysis.series[id] });
      }
    }
    return list.filter((overlay) => overlay.data?.length);
  }, [analysis, enabled]);

  const levels = useMemo(() => {
    const zones = (analysis?.chart?.supportResistance || []).slice(0, 4).map((zone) => ({
      price: (zone.low + zone.high) / 2,
      title: `${zone.kind} ${zone.touches}t`,
      color: zone.kind === "support" ? "#2f8062" : "#8b4046"
    }));

    if (!showFib) return zones;

    // Retracement levels measured from the most recent pivot range. They are
    // arithmetic reference points, not forecasts.
    const pivots = analysis?.chart?.pivots;
    const highs = (pivots?.highs || []).slice(-3);
    const lows = (pivots?.lows || []).slice(-3);
    if (!highs.length || !lows.length) return zones;
    const high = Math.max(...highs.map((pivot) => pivot.price));
    const low = Math.min(...lows.map((pivot) => pivot.price));
    if (!(high > low)) return zones;

    for (const ratio of [0.236, 0.382, 0.5, 0.618, 0.786]) {
      zones.push({
        price: high - (high - low) * ratio,
        title: `fib ${(ratio * 100).toFixed(1)}%`,
        color: "#56697a"
      });
    }
    return zones;
  }, [analysis, showFib]);

  const trendlines = useMemo(() => {
    if (!showPivots) return [];
    const pivots = analysis?.chart?.pivots;
    const lines = [];
    for (const [key, color] of [["highs", "#8b4046"], ["lows", "#2f8062"]]) {
      const points = (pivots?.[key] || []).slice(-2);
      if (points.length !== 2) continue;
      lines.push({
        from: { time: points[0].time, value: points[0].price },
        to: { time: points[1].time, value: points[1].price },
        color,
        label: `${key === "highs" ? "pivot highs" : "pivot lows"} trendline`
      });
    }
    return lines;
  }, [analysis, showPivots]);

  const chart = analysis?.chart;
  const indicators = analysis?.indicators;

  return (
    <section className="lab">
      <header className="lab-heading">
        <div>
          <span className="eyebrow">CHART LAB</span>
          <h1>
            Price structure, <span>calculated not guessed.</span>
          </h1>
          <p>
            Candles, indicators and geometric patterns are computed deterministically on the server. Overlays are server
            indicator series; no model is involved in anything on this screen.
          </p>
        </div>
        <div className="heading-side">
          <span className="chip">{instrument.exchange || "—"}</span>
          <span className="chip muted">{analysis?.interval || interval}</span>
        </div>
      </header>

      <CoverageBar compact />

      <div className="terminal-toolbar">
        <div className="toolbar-search">
          <InstrumentSearch onSelect={chooseInstrument} />
        </div>
        <div className="timeframe-row" role="group" aria-label="Timeframe">
          {TIMEFRAMES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={interval === value ? "timeframe active" : "timeframe"}
              onClick={() => chooseInterval(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mode-row" role="group" aria-label="Chart mode">
          <button type="button" className={mode === "candles" ? "mode active" : "mode"} onClick={() => setMode("candles")}>
            Candles
          </button>
          <button type="button" className={mode === "line" ? "mode active" : "mode"} onClick={() => setMode("line")}>
            Line
          </button>
          <button type="button" className={mode === "ohlc" ? "mode active" : "mode"} onClick={() => setMode("ohlc")}>
            OHLC
          </button>
          <button
            type="button"
            className="mode"
            onClick={() => load(instrument, interval, { force: true })}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="overlay-row">
        <span className="overlay-label">OVERLAYS</span>
        {OVERLAYS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={enabled.has(id) ? "overlay-toggle active" : "overlay-toggle"}
            onClick={() => toggleOverlay(id)}
            aria-pressed={enabled.has(id)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className={showPivots ? "overlay-toggle active" : "overlay-toggle"}
          onClick={() => setShowPivots((value) => !value)}
          aria-pressed={showPivots}
        >
          Pivot trendlines
        </button>
        <button
          type="button"
          className={showFib ? "overlay-toggle active" : "overlay-toggle"}
          onClick={() => setShowFib((value) => !value)}
          aria-pressed={showFib}
        >
          Fibonacci
        </button>
        <span className="overlay-note">Volume {analysis ? "on" : "—"}</span>
      </div>

      {error && (
        <div className="notice error" role="alert">
          <strong>{error.status === 503 ? "Market data is unavailable" : "Chart unavailable"}</strong>
          <p>{error.message}</p>
          {Array.isArray(error.details) && error.details.length > 0 && (
            <ul className="notice-list">
              {error.details.map((detail, index) => (
                <li key={index}>{typeof detail === "string" ? detail : `${detail.provider}: ${detail.message}`}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="lab-grid">
        <article className="panel chart-panel">
          <div className="quote-strip">
            <div>
              <span className="section-kicker">{instrument.symbol} · {instrument.exchange}</span>
              <h2>{instrument.name}</h2>
            </div>
            <div className="quote-numbers">
              {quote ? (
                <>
                  <strong>{formatMoney(quote.price, quote.currency)}</strong>
                  <span className={Number(quote.changePercent) >= 0 ? "positive-text" : "negative-text"}>
                    {formatPercent(quote.changePercent)}
                  </span>
                  <small>{quote.source} · {formatTime(quote.providerTimestamp || quote.retrievedAt)}</small>
                </>
              ) : (
                <span className="not-quoted">{quoteError || "No verified quote."}</span>
              )}
            </div>
            <div className="ohlc-strip">
              <span>O {number(analysis?.candles?.at(-1)?.open)}</span>
              <span>H {number(analysis?.candles?.at(-1)?.high)}</span>
              <span>L {number(analysis?.candles?.at(-1)?.low)}</span>
              <span>C {number(analysis?.candles?.at(-1)?.close)}</span>
              <span>V {compactVolume(analysis?.candles?.at(-1)?.volume)}</span>
            </div>
          </div>

          {loading && <div className="chart-placeholder loading">Loading candles…</div>}
          {!loading && analysis && (
            <PriceChart
              candles={analysis.candles}
              mode={mode}
              overlays={overlays}
              levels={levels}
              trendlines={trendlines}
              ariaLabel={`${analysis.symbol} ${analysis.interval} chart`}
            />
          )}
          {!loading && !analysis && <div className="chart-placeholder empty">Load an instrument to render its history.</div>}

          {analysis?.series && panes !== "off" && (
            <div className={panes === "both" ? "pane-grid two" : "pane-grid"}>
              <IndicatorPane
                title="RSI 14"
                ariaLabel={`${analysis.symbol} RSI pane`}
                series={[{ label: "RSI 14", color: "#e9bd68", data: analysis.series.rsi14 }]}
                guides={[
                  { value: 70, label: "70", color: "#5a3d3d" },
                  { value: 30, label: "30", color: "#2c4a3d" }
                ]}
              />
              {panes === "both" && (
                <IndicatorPane
                  title="MACD"
                  ariaLabel={`${analysis.symbol} MACD pane`}
                  series={[
                    { label: "MACD", color: "#79b7ff", data: analysis.series.macd },
                    { label: "Signal", color: "#e9bd68", data: analysis.series.macdSignal }
                  ]}
                  guides={[{ value: 0, label: "0", color: "#33424e" }]}
                />
              )}
            </div>
          )}

          {analysisWarning && <p className="muted-note">{analysisWarning}</p>}

          {analysis && (
            <div className="chart-foot">
              <span>{analysis.source}</span>
              <span>{analysis.coverage?.count ?? 0} candles</span>
              <span>{analysis.coverage?.from} → {analysis.coverage?.to}</span>
              <span>Indicators v{analysis.versions?.indicators}</span>
              <span>Retrieved {formatTime(analysis.retrievedAt)}</span>
            </div>
          )}
        </article>

        <aside className="lab-side">
          <article className="panel">
            <div className="panel-head compact">
              <h2>Structure</h2>
              {chart && <span className={`trend-chip ${chart.trend.label}`}>{chart.trend.label.replace("-", " ")}</span>}
            </div>
            {chart ? (
              <>
                <dl className="metric-grid">
                  <div>
                    <dt>Last close</dt>
                    <dd>{number(chart.lastClose)}</dd>
                  </div>
                  <div>
                    <dt>Candles</dt>
                    <dd>{chart.candles}</dd>
                  </div>
                  <div>
                    <dt>ATR 14</dt>
                    <dd>{number(indicators?.atr)}</dd>
                  </div>
                  <div>
                    <dt>RSI 14</dt>
                    <dd>{number(indicators?.rsi)}</dd>
                  </div>
                </dl>

                <h3 className="sub-heading">Support / resistance</h3>
                {chart.supportResistance.length ? (
                  <ul className="zone-list">
                    {chart.supportResistance.slice(0, 6).map((zone, index) => (
                      <li key={index}>
                        <span className={zone.kind === "support" ? "zone support" : "zone resistance"}>{zone.kind}</span>
                        <span>{number(zone.low)} – {number(zone.high)}</span>
                        <small>{zone.touches} touches</small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-note">No repeated pivot clusters in this window.</p>
                )}

                <h3 className="sub-heading">Detected patterns</h3>
                {chart.chartPatterns.length || chart.candlestickPatterns.length ? (
                  <ul className="pattern-list">
                    {chart.chartPatterns.map((pattern, index) => (
                      <li key={`chart-${index}`}>
                        <span className="pattern-name">{pattern.name}</span>
                        <span className={`pattern-status ${pattern.status}`}>{pattern.status}</span>
                        <small>{pattern.confidence}</small>
                      </li>
                    ))}
                    {chart.candlestickPatterns.slice(0, 5).map((pattern, index) => (
                      <li key={`candle-${index}`}>
                        <span className="pattern-name">{pattern.name}</span>
                        <span className="pattern-status forming">latest</span>
                        <small>{pattern.direction}</small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-note">No chart patterns detected on the latest candles.</p>
                )}
                {onNavigate && (
                  <button type="button" className="text-action block-action" onClick={() => onNavigate("structure", instrument)}>
                    Open market-structure lab →
                  </button>
                )}
              </>
            ) : (
              <p className="muted-note">Structure appears after a chart is loaded.</p>
            )}
          </article>

          <article className="panel">
            <div className="panel-head compact">
              <h2>Indicators</h2>
              {indicators && <span className="chip">server-calculated</span>}
            </div>
            {indicators ? (
              <dl className="indicator-list">
                {INDICATOR_ROWS.map(([label, read]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{number(read(indicators))}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="muted-note">Indicator values are returned with the chart.</p>
            )}
            <p className="muted-note">
              VWAP is anchored to the first candle in the window. Long-period averages show “—” when history is too
              short; nothing is interpolated.
            </p>
          </article>
        </aside>
      </div>
    </section>
  );
}
