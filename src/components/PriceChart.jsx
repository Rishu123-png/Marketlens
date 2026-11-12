import { useEffect, useRef } from "react";
import { CandlestickSeries, HistogramSeries, createChart } from "lightweight-charts";

/**
 * Presentation only. Every number in `candles` comes from the API; this
 * component never calculates an indicator or a level.
 *
 * Lightweight Charts expects either `YYYY-MM-DD` business days or UNIX seconds.
 * Daily candles already use business days; intraday candles arrive as ISO-like
 * datetimes and are converted to seconds.
 */
function toChartTime(time) {
  const value = String(time ?? "");
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const parsed = Date.parse(value.replace(" ", "T"));
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed / 1000);
}

function toSeries(candles) {
  const price = [];
  const volume = [];

  for (const candle of candles) {
    const time = toChartTime(candle.time);
    if (time === null) continue;

    price.push({ time, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
    if (Number.isFinite(Number(candle.volume))) {
      volume.push({
        time,
        value: Number(candle.volume),
        color: candle.close >= candle.open ? "rgba(57, 209, 154, 0.35)" : "rgba(251, 114, 120, 0.35)"
      });
    }
  }

  return { price, volume };
}

export default function PriceChart({ candles = [], height = 380, ariaLabel = "Price chart" }) {
  const container = useRef(null);
  const chartRef = useRef(null);
  const priceRef = useRef(null);
  const volumeRef = useRef(null);

  useEffect(() => {
    if (!container.current) return undefined;

    const chart = createChart(container.current, {
      height,
      layout: {
        background: { color: "transparent" },
        textColor: "#87939e",
        fontFamily: "'DM Mono', monospace",
        fontSize: 10
      },
      grid: {
        vertLines: { color: "#161f27" },
        horzLines: { color: "#161f27" }
      },
      rightPriceScale: { borderColor: "#202a33" },
      timeScale: { borderColor: "#202a33", timeVisible: false },
      crosshair: { mode: 0 },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true }
    });

    chartRef.current = chart;
    priceRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#39d19a",
      downColor: "#fb7278",
      borderVisible: false,
      wickUpColor: "#39d19a",
      wickDownColor: "#fb7278"
    });

    volumeRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false
    });
    volumeRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    const observer = new ResizeObserver(() => {
      if (!container.current) return;
      chart.applyOptions({ width: container.current.clientWidth });
    });
    observer.observe(container.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      priceRef.current = null;
      volumeRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    if (!priceRef.current || !volumeRef.current) return;
    const { price, volume } = toSeries(candles);
    priceRef.current.setData(price);
    volumeRef.current.setData(volume);
    if (price.length) chartRef.current?.timeScale().fitContent();
  }, [candles]);

  if (!candles.length) {
    return (
      <div className="chart-placeholder empty" role="status">
        No candles to display. Load an instrument to render the chart.
      </div>
    );
  }

  return (
    <div className="chart-wrap">
      <div ref={container} className="chart-canvas" role="img" aria-label={ariaLabel} />
    </div>
  );
}
