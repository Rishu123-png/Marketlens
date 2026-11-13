/**
 * Only draws a series supplied by the backend. With fewer than two verified
 * points it renders an explicit "no series" marker instead of a decorative
 * line that could be mistaken for market data.
 */
export default function Sparkline({ points = [], width = 96, height = 30, positive = true, label = "No verified series" }) {
  const values = points.filter((value) => value !== null && value !== undefined && value !== "").map(Number).filter(Number.isFinite);
  if (values.length < 2) {
    return (
      <span className="sparkline sparkline-empty" title={label} aria-label={label}>
        <i /><i /><i /><i /><i />
      </span>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const coords = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg
      className={`sparkline ${positive ? "is-up" : "is-down"}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      <polyline points={coords.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
