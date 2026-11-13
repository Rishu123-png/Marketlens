import Icon from "./Icon.jsx";

const LABELS = {
  chart: "Chart Agent",
  technical: "Technical Agent",
  news: "News Agent",
  sentiment: "Sentiment Agent",
  risk: "Risk Agent",
  coordinator: "Coordinator"
};

const ICONS = {
  chart: "candle",
  technical: "indicators",
  news: "news",
  sentiment: "globe",
  risk: "shield",
  coordinator: "sparkle"
};

function statusMeta(status) {
  if (!status || status === "—") return { tone: "idle", label: "IDLE", icon: "clock" };
  if (status === "COMPLETED") return { tone: "ok", label: "COMPLETE", icon: "check" };
  if (status === "RUNNING") return { tone: "active", label: "RUNNING", icon: "refresh" };
  if (status === "QUEUED" || status === "PENDING") return { tone: "queued", label: "QUEUED", icon: "clock" };
  if (status === "SKIPPED") return { tone: "muted", label: "SKIPPED", icon: "x" };
  if (status === "NOT_REQUESTED") return { tone: "muted", label: "NOT REQUESTED", icon: "x" };
  return { tone: "bad", label: status, icon: "warn" };
}

export default function AgentStatus({ agent, run, depth, compact = false }) {
  const notRequested = !run && ((agent === "news" && depth === "quick") || (agent === "sentiment" && ["quick", "standard"].includes(depth)));
  const meta = statusMeta(notRequested ? "NOT_REQUESTED" : run?.status);
  return (
    <div className={`agent-status agent-${agent} tone-${meta.tone} ${compact ? "is-compact" : ""}`.trim()} title={run?.error || undefined}>
      <span className="agent-glyph"><Icon name={ICONS[agent] || "ai"} size={14} /></span>
      <div className="agent-copy">
        <strong>{LABELS[agent] || agent}</strong>
        <small>
          {notRequested
            ? "Not requested at this research depth"
            : run?.error
            ? run.error.slice(0, 90)
            : run?.model
              ? `${run.model}${run.durationMs ? ` · ${(run.durationMs / 1000).toFixed(1)}s` : ""}`
              : "Awaiting evidence envelope"}
        </small>
      </div>
      <span className={`agent-state ${meta.tone}`}>
        <Icon name={meta.icon} size={10} strokeWidth={2.4} className={meta.tone === "active" ? "spin" : ""} />
        {meta.label}
      </span>
    </div>
  );
}
