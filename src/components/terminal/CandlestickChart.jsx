import PriceChart from "../PriceChart.jsx";
import DataStatus from "./DataStatus.jsx";
import EmptyState from "./EmptyState.jsx";
import { candleState, compactNumber, numberOrNull } from "../../lib/marketVisuals.js";

/**
 * Chart presentation wrapper. Candles and overlays are always server data; the
 * empty state is explicit instead of a decorative synthetic series.
 */
export default function CandlestickChart({
  analysis,
  loading,
  error,
  mode = "candles",
  overlays = [],
  levels = [],
  trendlines = [],
  height = 430,
  showVolume = true,
  emptyTitle = "No verified candles",
  emptyDetail,
  onCoverage
}) {
  const state = candleState(analysis);
  const candles = analysis?.candles || [];
  const latest = candles.at(-1);

  return (
    <div className="chart-frame">
      <div className="chart-meta-row">
        <DataStatus state={state} />
        <span>{analysis?.source || "provider not reported"}</span>
        <span>{analysis?.interval || "—"}</span>
        <span>{candles.length ? `${candles.length} candles` : "0 candles"}</span>
        {latest && (
          <span className="chart-ohlc">
            O <b>{numberOrNull(latest.open)?.toFixed(2) ?? "—"}</b>
            H <b>{numberOrNull(latest.high)?.toFixed(2) ?? "—"}</b>
            L <b>{numberOrNull(latest.low)?.toFixed(2) ?? "—"}</b>
            C <b>{numberOrNull(latest.close)?.toFixed(2) ?? "—"}</b>
            V <b>{compactNumber(latest.volume)}</b>
          </span>
        )}
      </div>

      <div className="chart-stage" style={{ minHeight: height }}>
        {loading && (
          <div className="chart-loading">
            <span className="loader-ring" />
            <strong>Requesting candles</strong>
            <p>Deterministic indicators load after the candle request. No AI call is made.</p>
          </div>
        )}
        {!loading && candles.length > 0 && (
          <PriceChart
            candles={candles}
            height={height}
            mode={mode}
            overlays={overlays}
            levels={levels}
            trendlines={trendlines}
            showVolume={showVolume}
            ariaLabel={`${analysis.symbol} ${analysis.interval} price chart`}
          />
        )}
        {!loading && !candles.length && (
          <div className="chart-empty-overlay">
            <EmptyState
              icon="candle"
              title={emptyTitle}
              detail={
                emptyDetail ||
                error?.message ||
                "The configured providers did not return history. The chart does not draw a substitute series."
              }
              action={onCoverage ? <button type="button" className="t-btn secondary sm" onClick={onCoverage}>Check coverage</button> : null}
            />
          </div>
        )}
      </div>
      {error?.details?.length > 0 && (
        <div className="chart-provider-errors">
          {error.details.slice(0, 3).map((detail, index) => (
            <span key={index}>{typeof detail === "string" ? detail : `${detail.provider}: ${detail.message}`}</span>
          ))}
        </div>
      )}
    </div>
  );
}
