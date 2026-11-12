import { useEffect, useRef } from "react";
import { LineSeries, createChart } from "lightweight-charts";

/**
 * A small server-series-only indicator pane. Values come from `/api/analysis`
 * series; nothing here recalculates an indicator or invents a missing point.
 */
function toChartTime(time) {
  const value = String(time ?? "");
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = Date.parse(value.replace(" ", "T"));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function toData(series) {
  return (series || [])
    .map((point) => ({ time: toChartTime(point.time), value: point.value }))
    .filter((point) => point.time !== null && Number.isFinite(point.value));
}

export default function IndicatorPane({ title, series = [], height = 132, guides = [], ariaLabel }) {
  const container = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!container.current) return undefined;

    const chart = createChart(container.current, {
      height,
      layout: {
        background: { color: "transparent" },
        textColor: "#87939e",
        fontFamily: "'DM Mono', monospace",
        fontSize: 9
      },
      grid: {
        vertLines: { color: "#121a21" },
        horzLines: { color: "#121a21" }
      },
      rightPriceScale: { borderColor: "#202a33", scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderColor: "#202a33", timeVisible: false, visible: false },
      crosshair: { mode: 0 }
    });
    chartRef.current = chart;

    const observer = new ResizeObserver(() => {
      if (container.current) chart.applyOptions({ width: container.current.clientWidth });
    });
    observer.observe(container.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const created = [];
    for (const line of series) {
      const data = toData(line.data);
      if (!data.length) continue;
      const lineSeries = chart.addSeries(LineSeries, {
        color: line.color || "#79b7ff",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        title: line.label
      });
      lineSeries.setData(data);
      created.push(lineSeries);
    }

    if (created[0]) {
      for (const guide of guides) {
        if (!Number.isFinite(guide.value)) continue;
        created[0].createPriceLine({
          price: guide.value,
          color: guide.color || "#33424e",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: guide.label || ""
        });
      }
    }

    if (created.length) chart.timeScale().fitContent();
  }, [series, guides]);

  return (
    <article className="indicator-pane" aria-label={ariaLabel || `${title} indicator pane`}>
      <header>
        <span className="section-kicker">{title}</span>
        <span className="indicator-pane-legend">
          {series.map((line) => (
            <span key={line.label} style={{ color: line.color || "#79b7ff" }}>
              {line.label}
            </span>
          ))}
        </span>
      </header>
      <div ref={container} className="indicator-pane-canvas" />
    </article>
  );
}
