import Icon from "./Icon.jsx";

export default function EmptyState({ icon = "info", title = "Nothing to display", detail, action, compact = false }) {
  return (
    <div className={`empty-state ${compact ? "is-compact" : ""}`.trim()} role="status">
      <span className="empty-icon"><Icon name={icon} size={compact ? 16 : 20} /></span>
      <div>
        <strong>{title}</strong>
        {detail && <p>{detail}</p>}
      </div>
      {action}
    </div>
  );
}
