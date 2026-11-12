import CoverageBar from "../components/CoverageBar.jsx";
import { useState } from "react";
import PriceChart from "../components/PriceChart.jsx";
import { api, formatMoney } from "../lib/api.js";

const INTERVALS = [
  ["1day", "Daily"],
  ["1week", "Weekly"],
  ["1h", "Hourly"],
  ["15min", "15 minutes"]
];

const EXCHANGES = ["NSE", "BSE", "NASDAQ", "NYSE"];

const INDICATOR_ROWS = [
  ["RSI 14", (i) => i?.rsi],
  ["MACD", (i) => i?.macd],
  ["SMA 20", (i) => i?.movingAverages?.sma20],
  ["SMA 50", (i) => i?.movingAverages?.sma50],
  ["SMA 200", (i) => i?.movingAverages?.sma200],
  ["ATR 14", (i) => i?.atr],
  ["Rel. volume", (i) => i?.relativeVolume]
];

function number(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return Number(value).toFixed(digits);
}

export default function ChartLab() {
  const [symbol, setSymbol] = useState("RELIANCE");
  const [exchange, setExchange] = useState("NSE");
  const [interval, setInterval] = useState("1day");
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function load(event) {
    event?.preventDefault();
    const clean = symbol.trim().toUpperCase();
    if (!clean) {
      setError({ message: "Enter a symbol to load." });
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await api(
        `/api/analysis?symbol=${encodeURIComponent(clean)}` +
          `&exchange=${encodeURIComponent(exchange)}&interval=${encodeURIComponent(interval)}&limit=260`
      );
      setAnalysis(data);
    } catch (requestError) {
      setAnalysis(null);
      setError({
        message: requestError.message,
        status: requestError.status,
        details: requestError.details
      });
    } finally {
      setLoading(false);
    }
  }

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
            Candles, indicators and geometric patterns are computed deterministically on the server. No model is
            involved in anything on this screen.
          </p>
        </div>
      </header>

      <CoverageBar />

      <form className="lab-controls" onSubmit={load}>
        <label>
          <span>SYMBOL</span>
          <input value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="RELIANCE" autoComplete="off" />
        </label>
        <label>
          <span>EXCHANGE</span>
          <select value={exchange} onChange={(event) => setExchange(event.target.value)}>
            {EXCHANGES.map((venue) => (
              <option key={venue} value={venue}>
                {venue}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>INTERVAL</span>
          <select value={interval} onChange={(event) => setInterval(event.target.value)}>
            {INTERVALS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="primary-action" disabled={loading}>
          {loading ? "Loading…" : "Load chart"}
        </button>
      </form>

      {error && (
        <div className="notice error" role="alert">
          <strong>{error.status === 503 ? "Market data is not configured" : "Chart unavailable"}</strong>
          <p>{error.message}</p>
          {error.status === 503 && (
            <p className="notice-hint">
              Configure at least one market-data provider key (FMP_API_KEY, TWELVE_DATA_API_KEY or
              ALPHA_VANTAGE_API_KEY). Candle history requires Twelve Data or Alpha Vantage.
            </p>
          )}
          {Array.isArray(error.details) && error.details.length > 0 && (
            <ul className="notice-list">
              {error.details.map((detail, index) => (
                <li key={index}>
                  {typeof detail === "string" ? detail : `${detail.provider}: ${detail.message}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="lab-grid">
        <article className="panel chart-panel">
          <div className="panel-head">
            <div>
              <span className="section-kicker">{analysis ? analysis.symbol : "INSTRUMENT"}</span>
              <h2>{analysis ? `${analysis.symbol} · ${analysis.interval}` : "Candlestick chart"}</h2>
            </div>
            {analysis && (
              <div className="chart-meta">
                <span>{analysis.source}</span>
                <span>{analysis.coverage?.count ?? 0} candles</span>
                <span>{analysis.coverage?.from} → {analysis.coverage?.to}</span>
              </div>
            )}
          </div>

          {loading && <div className="chart-placeholder loading">Loading candles…</div>}
          {!loading && analysis && <PriceChart candles={analysis.candles} ariaLabel={`${analysis.symbol} candlestick chart`} />}
          {!loading && !analysis && <div className="chart-placeholder empty">Load an instrument to render its history.</div>}

          {analysis && (
            <div className="chart-foot">
              <span>Indicators v{analysis.versions?.indicators}</span>
              <span>Patterns v{analysis.versions?.patterns}</span>
              <span>Retrieved {new Date(analysis.retrievedAt).toLocaleString("en-IN")}</span>
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
                <p className="structure-note">
                  {chart.trend.method === "net-change-fallback"
                    ? "Classified from net price change because the series has too few swing pivots."
                    : "Classified from swing pivots (higher highs / higher lows)."}
                </p>
                <dl className="metric-grid">
                  <div>
                    <dt>Last close</dt>
                    <dd>{number(chart.lastClose)}</dd>
                  </div>
                  <div>
                    <dt>Candles</dt>
                    <dd>{chart.candles}</dd>
                  </div>
                </dl>

                <h3 className="sub-heading">Zones</h3>
                {chart.supportResistance.length ? (
                  <ul className="zone-list">
                    {chart.supportResistance.map((zone, index) => (
                      <li key={index}>
                        <span className={zone.kind === "support" ? "zone support" : "zone resistance"}>{zone.kind}</span>
                        <span>
                          {number(zone.low)} – {number(zone.high)}
                        </span>
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
                        <small>{pattern.confidence} confidence</small>
                      </li>
                    ))}
                    {chart.candlestickPatterns.map((pattern, index) => (
                      <li key={`candle-${index}`}>
                        <span className="pattern-name">{pattern.name}</span>
                        <span className="pattern-status forming">latest candle</span>
                        <small>{pattern.direction}</small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-note">No chart patterns detected on the latest candles.</p>
                )}
              </>
            ) : (
              <p className="muted-note">Structure appears after a chart is loaded.</p>
            )}
          </article>

          <article className="panel">
            <div className="panel-head compact">
              <h2>Indicators</h2>
              {indicators && <span className="chip">calculated</span>}
            </div>
            {indicators ? (
              <dl className="indicator-list">
                {INDICATOR_ROWS.map(([label, read]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{number(read(indicators))}</dd>
                  </div>
                ))}
                <div>
                  <dt>Bollinger upper</dt>
                  <dd>{number(indicators.bollinger?.upper)}</dd>
                </div>
                <div>
                  <dt>Bollinger lower</dt>
                  <dd>{number(indicators.bollinger?.lower)}</dd>
                </div>
              </dl>
            ) : (
              <p className="muted-note">Indicator values are returned with the chart.</p>
            )}
            {indicators && (
              <p className="muted-note">
                {indicators.candles} candles used. Long-period averages show “—” when history is too short.
              </p>
            )}
          </article>

          {analysis?.limitations && (
            <article className="panel">
              <div className="panel-head compact">
                <h2>Limitations</h2>
              </div>
              <ul className="limitation-list">
                {analysis.limitations.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
                {analysis.chart?.limitations?.map((line, index) => (
                  <li key={`chart-${index}`}>{line}</li>
                ))}
              </ul>
            </article>
          )}
        </aside>
      </div>

      <footer className="lab-foot">
        Research and educational analysis only. Historical structure is not a forecast and prices are delayed by the
        provider’s own latency. {analysis ? `Last close ${formatMoney(analysis.chart?.lastClose)}.` : ""}
      </footer>
    </section>
  );
}
