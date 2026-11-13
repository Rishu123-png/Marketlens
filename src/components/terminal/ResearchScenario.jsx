import Icon from "./Icon.jsx";

const META = {
  bullish: { title: "Bullish", icon: "up", tone: "bull" },
  bearish: { title: "Bearish", icon: "down", tone: "bear" },
  neutral: { title: "Neutral", icon: "target", tone: "neutral" }
};

export default function ResearchScenario({ tone = "neutral", text, conditions, invalidation, evidenceIds = [], unavailable = false }) {
  const meta = META[tone] || META.neutral;
  return (
    <article className={`scenario-card ${meta.tone}`}>
      <header>
        <span className="scenario-icon"><Icon name={meta.icon} size={15} strokeWidth={2.2} /></span>
        <strong>{meta.title}</strong>
        <span className="scenario-state">{unavailable ? "UNAVAILABLE" : "CONDITIONAL"}</span>
      </header>
      {unavailable ? (
        <p className="scenario-placeholder">No coordinator scenario was returned. This is not evidence that the case is weak.</p>
      ) : (
        <>
          <p>{text}</p>
          {conditions?.length > 0 && (
            <div className="scenario-conditions">
              <span>CONDITIONS</span>
              <ul>{conditions.map((item, index) => <li key={index}>{item}</li>)}</ul>
            </div>
          )}
          {invalidation && <small><b>Invalidation:</b> {invalidation}</small>}
          {evidenceIds.length > 0 && <footer>{evidenceIds.slice(0, 5).map((id) => <span key={id}>{id}</span>)}</footer>}
        </>
      )}
    </article>
  );
}
