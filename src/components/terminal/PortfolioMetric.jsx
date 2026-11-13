import Icon from "./Icon.jsx";

export default function PortfolioMetric({ label, value, change, detail, icon = "wallet", tone = "default", children }) {
  return (
    <article className={`portfolio-metric tone-${tone}`}>
      <header>
        <span>{label}</span>
        <Icon name={icon} size={14} />
      </header>
      <strong className={tone === "up" ? "value-up" : tone === "down" ? "value-down" : ""}>{value}</strong>
      <div className="portfolio-metric-foot">
        {change}
        {detail && <small>{detail}</small>}
      </div>
      {children}
    </article>
  );
}
