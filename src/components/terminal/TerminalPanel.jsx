export default function TerminalPanel({
  title,
  kicker,
  actions,
  children,
  className = "",
  bodyClassName = "",
  tone = "default",
  as: Tag = "section",
  ...rest
}) {
  return (
    <Tag className={`t-panel t-panel-${tone} ${className}`.trim()} {...rest}>
      {(title || kicker || actions) && (
        <header className="t-panel-head">
          <div className="t-panel-heading">
            {kicker && <span className="t-kicker">{kicker}</span>}
            {title && <h2>{title}</h2>}
          </div>
          {actions && <div className="t-panel-actions">{actions}</div>}
        </header>
      )}
      <div className={`t-panel-body ${bodyClassName}`.trim()}>{children}</div>
    </Tag>
  );
}
