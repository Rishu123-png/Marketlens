import { useCallback, useEffect, useMemo, useState } from "react";
import InstrumentSearch from "../components/InstrumentSearch.jsx";
import PriceChart from "../components/PriceChart.jsx";
import { api, formatPercent, formatTime } from "../lib/api.js";

const TIMEFRAMES = [
  ["15min", "15m"],
  ["1h", "1H"],
  ["4h", "4H"],
  ["1day", "1D"],
  ["1week", "1W"]
];

const GROUP_LABELS = {
  BOS: "Break of structure",
  CHoCH: "Change of character",
  "order-block-hypothesis": "Order-block hypotheses",
  "fair-value-gap": "Fair value gaps",
  "equal-highs": "Equal highs",
  "equal-lows": "Equal lows",
  "liquidity-sweep-hypothesis": "Liquidity-sweep hypotheses"
};

const GROUP_ORDER = Object.keys(GROUP_LABELS);

function number(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return Number(value).toFixed(digits);
}

export default function StructureLab({ initialInstrument }) {
  const [instrument, setInstrument] = useState(
    initialInstrument || { symbol: "RELIANCE", exchange: "NSE", name: "Reliance Industries Ltd" }
  );
  const [interval, setInterval] = useState("1day");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (target = instrument, timeframe = interval) => {
    if (!target?.symbol) return;
    setLoading(true);
    setError(null);
    try {
      const payload = await api(
        `/api/structure?symbol=${encodeURIComponent(target.symbol)}` +
          `&exchange=${encodeURIComponent(target.exchange || "")}` +
          `&interval=${encodeURIComponent(timeframe)}&limit=400`
      );
      setData(payload);
    } catch (cause) {
      setData(null);
      setError({ message: cause.message, status: cause.status, details: cause.details });
    } finally {
      setLoading(false);
    }
  }, [instrument, interval]);

  useEffect(() => {
    load(instrument, interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    const map = {};
    for (const signal of data?.structure?.signals || []) {
      map[signal.type] = map[signal.type] || [];
      map[signal.type].push(signal);
    }
    return map;
  }, [data]);

  const levels = useMemo(() => {
    const list = [];
    for (const zone of data?.structure?.supportResistance || []) {
      list.push({
        price: (zone.low + zone.high) / 2,
        title: `${zone.kind} ${zone.touches}t`,
        color: zone.kind === "support" ? "#2f8062" : "#8b4046"
      });
    }
    for (const signal of data?.structure?.signals || []) {
      if (signal.level && list.length < 12) {
        list.push({
          price: signal.level,
          title: `${signal.type} ${signal.direction || ""}`.trim(),
          color: signal.direction === "bearish" ? "#a3545a" : "#3f8f72"
        });
      }
    }
    return list;
  }, [data]);

  return (
    <section className="lab">
      <header className="lab-heading">
        <div>
          <span className="eyebrow">MARKET STRUCTURE</span>
          <h1>
            Liquidity geometry, <span>stated as hypotheses.</span>
          </h1>
          <p>
            BOS, CHoCH, order blocks, fair value gaps, equal highs/lows and sweeps are detected from the candles you
            load. The engine cannot see institutional order books; every signal names its rule, timeframe and
            invalidation.
          </p>
        </div>
        <div className="heading-side">
          <span className="chip">engine v{data?.engineVersion || "—"}</span>
          <span className="chip muted">{data?.candles || 0} candles</span>
        </div>
      </header>

      <div className="terminal-toolbar">
        <div className="toolbar-search">
          <InstrumentSearch
            onSelect={(next) => {
              setInstrument(next);
              load(next, interval);
            }}
          />
        </div>
        <div className="timeframe-row" role="group" aria-label="Structure timeframe">
          {TIMEFRAMES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={interval === value ? "timeframe active" : "timeframe"}
              onClick={() => {
                setInterval(value);
                load(instrument, value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="notice error" role="alert">
          <strong>{error.status === 503 ? "Candles are unavailable" : "Structure unavailable"}</strong>
          <p>{error.message}</p>
          {Array.isArray(error.details) && (
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
          <div className="panel-head">
            <div>
              <span className="section-kicker">{instrument.symbol} · {instrument.exchange}</span>
              <h2>{instrument.name} · {interval} structure</h2>
            </div>
            {data && (
              <div className="chart-meta">
                <span>{data.source}</span>
                <span>{data.candles} candles</span>
                <span>{formatTime(data.retrievedAt)}</span>
              </div>
            )}
          </div>

          {loading && <div className="chart-placeholder loading">Loading structure…</div>}
          {!loading && data && (
            <PriceChart candles={data.candles} levels={levels} ariaLabel={`${data.symbol} structure chart`} />
          )}
          {!loading && !data && <div className="chart-placeholder empty">Load an instrument to derive structure.</div>}

          {data && (
            <div className="chart-foot">
              <span>Last close {number(data.structure.lastClose)}</span>
              <span>ATR 14 {number(data.structure.atr)}</span>
              <span>{data.structure.signals.length} signals</span>
              <span>Dropped rows {data.droppedRows}</span>
            </div>
          )}
        </article>

        <aside className="lab-side">
          <article className="panel">
            <div className="panel-head compact">
              <h2>Signals</h2>
              <span className="chip muted">deterministic</span>
            </div>
            {data?.structure?.signals?.length ? (
              GROUP_ORDER.filter((type) => grouped[type]?.length).map((type) => (
                <div key={type} className="signal-group">
                  <h3 className="sub-heading">
                    {GROUP_LABELS[type]} <span className="count-chip">{grouped[type].length}</span>
                  </h3>
                  <ul className="signal-list">
                    {grouped[type].map((signal, index) => (
                      <li key={index} className={`signal-card ${signal.direction || ""}`}>
                        <div className="signal-head">
                          <strong>{signal.direction || signal.status}</strong>
                          {Number.isFinite(signal.low) && Number.isFinite(signal.high) ? (
                            <span>{number(signal.low)} – {number(signal.high)}</span>
                          ) : (
                            <span>{number(signal.level)}</span>
                          )}
                          <span className={`confidence ${signal.confidence}`}>{signal.confidence}</span>
                        </div>
                        {Number.isFinite(signal.displacementAtr) && <small>{signal.displacementAtr}× ATR displacement</small>}
                        {signal.status && <small>status: {signal.status}</small>}
                        <p>{signal.rule}</p>
                        <p className="signal-invalidation">Invalidation: {signal.invalidation}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <p className="muted-note">No structure hypotheses detected on this window.</p>
            )}
          </article>

          <article className="panel">
            <div className="panel-head compact">
              <h2>Rules applied</h2>
            </div>
            <ul className="limitation-list">
              {(data?.structure?.rules || []).map((rule, index) => (
                <li key={index}>{rule}</li>
              ))}
            </ul>
            <h3 className="sub-heading">Limitations</h3>
            <ul className="limitation-list">
              {(data?.structure?.limitations || []).map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </article>
        </aside>
      </div>
    </section>
  );
}
