const FALLBACK = { code: "unavailable", label: "UNAVAILABLE" };

export default function DataStatus({ state = FALLBACK, detail, showLabel = true, compact = false, className = "" }) {
  const value = state || FALLBACK;
  return (
    <span
      className={`data-status state-${value.code} ${compact ? "is-compact" : ""} ${className}`.trim()}
      title={detail || value.detail || value.label}
    >
      <i aria-hidden="true" />
      {showLabel && <span>{value.label}</span>}
    </span>
  );
}
