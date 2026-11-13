import Icon from "./Icon.jsx";

const TONES = {
  verified: { icon: "check", label: "Verified" },
  delayed: { icon: "clock", label: "Delayed" },
  historical: { icon: "layers", label: "Historical" },
  unverified: { icon: "warn", label: "Unverified" },
  unavailable: { icon: "x", label: "Unavailable" },
  ai: { icon: "sparkle", label: "AI interpretation" }
};

export default function EvidenceBadge({ tone = "unverified", children, title }) {
  const meta = TONES[tone] || TONES.unverified;
  return (
    <span className={`evidence-badge tone-${tone}`} title={title}>
      <Icon name={meta.icon} size={11} strokeWidth={2.2} />
      {children || meta.label}
    </span>
  );
}
