import { useEffect, useRef } from "react";
import { BarSeries, CandlestickSeries, HistogramSeries, LineSeries, createChart } from "lightweight-charts";

/**
 * Presentation only. Candles, indicator series and levels all arrive from the
 * API; this component never computes an indicator or a level.
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

function toLine(series) {
  return (series || [])
    .map((point) => ({ time: toChartTime(point.time), value: point.value }))
    .filter((point) => point.time !== null && Number.isFinite(point.value))
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

export default function PriceChart({
  candles = [],
  height = 420,
  ariaLabel = "Price chart",
  mode = "candles",
  overlays = [],
  levels = [],
  trendlines = [],
  showVolume = true
}) {
  const container = useRef(null);
  const chartRef = useRef(null);
  const mainRef = useRef(null);
  const volumeRef = useRef(null);
  const overlayRefs = useRef([]);
  const levelRefs = useRef([]);
  const trendlineRefs = useRef([]);

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

    const observer = new ResizeObserver(() => {
      if (!container.current) return;
      chart.applyOptions({ width: container.current.clientWidth });
    });
    observer.observe(container.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
      volumeRef.current = null;
      overlayRefs.current = [];
      levelRefs.current = [];
      trendlineRefs.current = [];
    };
  }, [height]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (mainRef.current) {
      chart.removeSeries(mainRef.current);
      mainRef.current = null;
    }

    if (mode === "line") {
      mainRef.current = chart.addSeries(LineSeries, {
        color: "#39d19a",
        lineWidth: 2,
        priceLineVisible: true,
        lastValueVisible: true
      });
    } else if (mode === "ohlc") {
      mainRef.current = chart.addSeries(BarSeries, {
        upColor: "#39d19a",
        downColor: "#fb7278",
        thinBars: false
      });
    } else {
      mainRef.current = chart.addSeries(CandlestickSeries, {
        upColor: "#39d19a",
        downColor: "#fb7278",
        borderVisible: false,
        wickUpColor: "#39d19a",
        wickDownColor: "#fb7278"
      });
    }
  }, [mode]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (volumeRef.current) {
      chart.removeSeries(volumeRef.current);
      volumeRef.current = null;
    }
    if (!showVolume) return;

    volumeRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false
    });
    volumeRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  }, [showVolume]);

  useEffect(() => {
    if (!mainRef.current) return;
    const { price, volume } = toSeries(candles);

    if (mode === "line") {
      mainRef.current.setData(price.map((point) => ({ time: point.time, value: point.close })));
    } else {
      mainRef.current.setData(price);
    }
    if (volumeRef.current) volumeRef.current.setData(volume);
    if (price.length) chartRef.current?.timeScale().fitContent();
  }, [candles, mode]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    for (const series of overlayRefs.current) chart.removeSeries(series);
    overlayRefs.current = [];

    for (const overlay of overlays) {
      const data = toLine(overlay.data);
      if (!data.length) continue;
      const series = chart.addSeries(LineSeries, {
        color: overlay.color || "#87939e",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        title: overlay.label
      });
      series.setData(data);
      overlayRefs.current.push(series);
    }
  }, [overlays]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    for (const series of trendlineRefs.current) chart.removeSeries(series);
    trendlineRefs.current = [];

    for (const line of trendlines || []) {
      const from = toChartTime(line.from?.time);
      const to = toChartTime(line.to?.time);
      if (from === null || to === null) continue;
      if (!Number.isFinite(line.from?.value) || !Number.isFinite(line.to?.value)) continue;
      const series = chart.addSeries(LineSeries, {
        color: line.color || "#8ba1b3",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        title: line.label || "pivot line"
      });
      series.setData([
        { time: from, value: line.from.value },
        { time: to, value: line.to.value }
      ]);
      trendlineRefs.current.push(series);
    }
  }, [trendlines]);

  useEffect(() => {
    const series = mainRef.current;
    if (!series) return;

    for (const line of levelRefs.current) {
      try {
        series.removePriceLine(line);
      } catch {
        /* series may have been recreated */
      }
    }
    levelRefs.current = [];

    for (const level of levels) {
      if (!Number.isFinite(Number(level.price))) continue;
      levelRefs.current.push(
        series.createPriceLine({
          price: Number(level.price),
          color: level.color || "#4a5a66",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: String(level.title || "").slice(0, 24)
        })
      );
    }
  }, [levels, mode]);

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
