import CoverageBar from "../components/CoverageBar.jsx";
import { useEffect, useRef, useState } from "react";
import { api, formatTime } from "../lib/api.js";

const DEPTHS = [
  ["quick", "Quick — quote, chart, technical, risk"],
  ["standard", "Standard — adds news"],
  ["comprehensive", "Comprehensive — adds sentiment"]
];

const SECTION_ORDER = [
  ["executiveSummary", "Executive summary"],
  ["instrument", "Instrument"],
  ["marketContext", "Market context"],
  ["chart", "Chart structure"],
  ["technical", "Technical"],
  ["news", "News"],
  ["sentiment", "Sentiment"],
  ["risk", "Risk"],
  ["conflicts", "Conflicts"],
  ["observations", "Observations"],
  ["limitations", "Limitations"],
  ["sources", "Sources"],
  ["methodology", "Methodology"]
];

const TERMINAL = ["COMPLETED", "PARTIAL", "BLOCKED", "FAILED", "CANCELLED"];
const AGENTS = ["chart", "technical", "news", "sentiment", "risk", "coordinator"];

const fmt = (value) => (value === null || value === undefined ? "—" : String(value));

function GateBadge({ verdict }) {
  if (!verdict) return <span className="gate-badge pending">no verdict yet</span>;
  const tone = verdict === "PASS" ? "pass" : verdict === "PASS_WITH_WARNINGS" ? "warn" : "blocked";
  return <span className={`gate-badge ${tone}`}>{verdict.replaceAll("_", " ")}</span>;
}

function renderValue(value) {
  if (Array.isArray(value)) {
    if (!value.length) return <p className="muted-note">None recorded.</p>;
    return (
      <ul className="section-list">
        {value.map((entry, index) => (
          <li key={index}>{String(entry)}</li>
        ))}
      </ul>
    );
  }
  return <p className="section-body">{String(value)}</p>;
}

export default function ResearchLab() {
  const [symbol, setSymbol] = useState("RELIANCE");
  const [exchange, setExchange] = useState("NSE");
  const [depth, setDepth] = useState("standard");
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState(null);
  const [report, setReport] = useState(null);
  const [agentRuns, setAgentRuns] = useState({});
  const [evidence, setEvidence] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api("/api/jobs")
      .then((data) => {
        if (!cancelled) setJobs(data.jobs || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [job?.status]);

  useEffect(() => () => window.clearInterval(pollRef.current), []);

  function watch(id, initial) {
    window.clearInterval(pollRef.current);
    setJob(initial);

    pollRef.current = window.setInterval(async () => {
      try {
        const detail = await api(`/api/jobs/${encodeURIComponent(id)}`);
        setJob(detail.job);
        setAgentRuns(detail.agentRuns || {});
        setReport(detail.report);
        setEvidence(detail.evidence);
        setWarnings(detail.dataWarnings || []);

        if (TERMINAL.includes(detail.job.status)) {
          window.clearInterval(pollRef.current);
        }
      } catch (pollError) {
        setError({ message: pollError.message, status: pollError.status });
        window.clearInterval(pollRef.current);
      }
    }, 3000);
  }

  async function startResearch(event) {
    event.preventDefault();
    const clean = symbol.trim().toUpperCase();
    if (!clean) {
      setError({ message: "Enter a symbol to research." });
      return;
    }

    setBusy(true);
    setError(null);
    setReport(null);
    setEvidence(null);
    setAgentRuns({});
    setWarnings([]);
    setJob(null);

    try {
      const created = await api("/api/research", {
        method: "POST",
        body: { symbol: clean, exchange, depth }
      });

      setJobId(created.jobId);
      watch(created.jobId, {
        jobId: created.jobId,
        status: created.status,
        depth: created.depth,
        instrumentId: created.instrumentId,
        createdAt: new Date().toISOString()
      });

      if (created.queue?.queue === "memory") {
        setWarnings([
          "The dev queue is process-local. Run `npm run worker` in this workspace to execute the job."
        ]);
      }
    } catch (createError) {
      setError({
        message: createError.message,
        status: createError.status,
        details: createError.details
      });
    } finally {
      setBusy(false);
    }
  }

  const running = job && !TERMINAL.includes(job.status);

  return (
    <section className="lab">
      <header className="lab-heading">
        <div>
          <span className="eyebrow">RESEARCH</span>
          <h1>
            Six agents, <span>one evidence trail.</span>
          </h1>
          <p>
            A research job runs in the background worker, never inside a web request. Each specialist reports separately;
            the deterministic gate decides whether a report may be published.
          </p>
        </div>
      </header>

      <CoverageBar />

      <form className="lab-controls" onSubmit={startResearch}>
        <label>
          <span>SYMBOL</span>
          <input value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="RELIANCE" autoComplete="off" />
        </label>
        <label>
          <span>EXCHANGE</span>
          <select value={exchange} onChange={(event) => setExchange(event.target.value)}>
            {["NSE", "BSE", "NASDAQ", "NYSE"].map((venue) => (
              <option key={venue}>{venue}</option>
            ))}
          </select>
        </label>
        <label className="wide">
          <span>DEPTH</span>
          <select value={depth} onChange={(event) => setDepth(event.target.value)}>
            {DEPTHS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="primary-action" disabled={busy || running}>
          {busy ? "Creating…" : running ? "Research running…" : "Create research job"}
        </button>
      </form>

      {error && (
        <div className="notice error" role="alert">
          <strong>{error.status === 503 ? "Service not configured" : "Research unavailable"}</strong>
          <p>{error.message}</p>
          {error.status === 503 && (
            <p className="notice-hint">
              Research requires GROQ_API_KEY on the server. The UI never holds provider keys.
            </p>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="notice info">
          <strong>Worker notes</strong>
          <ul className="notice-list">
            {warnings.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="research-layout">
        <article className="panel research-status">
          <div className="panel-head">
            <div>
              <span className="section-kicker">JOB</span>
              <h2>{job ? job.jobId : "No job selected"}</h2>
            </div>
            <div className="status-cluster">
              <span className={`job-chip ${(job?.status || "IDLE").toLowerCase()}`}>{job?.status || "IDLE"}</span>
              <GateBadge verdict={job?.gate?.verdict ?? report?.gate?.verdict} />
            </div>
          </div>

          <dl className="metric-grid">
            <div>
              <dt>Instrument</dt>
              <dd>{fmt(job?.instrumentId)}</dd>
            </div>
            <div>
              <dt>Depth</dt>
              <dd>{fmt(job?.depth)}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{job?.createdAt ? formatTime(job.createdAt) : "—"}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{job?.updatedAt ? formatTime(job.updatedAt) : "—"}</dd>
            </div>
          </dl>

          {job?.status === "QUEUED" && (
            <p className="muted-note">
              Waiting for a worker. Locally: <code>npm run worker</code>. In production the job is delivered by QStash to
              the worker deployment.
            </p>
          )}

          <h3 className="sub-heading">Agent status</h3>
          <ul className="agent-status-list">
            {AGENTS.map((agent) => {
              const run = agentRuns[agent];
              const status = run?.status || (run === undefined ? "—" : run.status);
              return (
                <li key={agent}>
                  <span className="agent-name">{agent}</span>
                  <span className={`agent-chip ${String(status).toLowerCase()}`}>{status}</span>
                  {run?.error && <small title={run.error}>{run.error.slice(0, 120)}</small>}
                </li>
              );
            })}
          </ul>

          {job?.gate?.blocking?.length > 0 && (
            <>
              <h3 className="sub-heading">Blocking findings</h3>
              <ul className="section-list blocking">
                {job.gate.blocking.map((finding, index) => (
                  <li key={index}>
                    <strong>{finding.rule}</strong> — {finding.message}
                  </li>
                ))}
              </ul>
            </>
          )}

          {job?.gate?.warnings?.length > 0 && (
            <>
              <h3 className="sub-heading">Warnings</h3>
              <ul className="section-list">
                {job.gate.warnings.slice(0, 12).map((finding, index) => (
                  <li key={index}>
                    <strong>{finding.rule}</strong> — {finding.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </article>

        <article className="panel research-report">
          <div className="panel-head">
            <div>
              <span className="section-kicker">REPORT</span>
              <h2>{report ? report.reportId : "Pending"}</h2>
            </div>
            {report && <span className="chip">{report.depth}</span>}
          </div>

          {!report && (
            <p className="muted-note">
              {job
                ? "The report appears when the job finishes. Sections are only published for agents that completed."
                : "Create a research job to see the report here."}
            </p>
          )}

          {report &&
            SECTION_ORDER.map(([key, label]) => {
              const value = report.sections?.[key];
              if (value === undefined) return null;
              const unavailable = typeof value === "string" && value.startsWith("Section unavailable");
              return (
                <details className="report-section" key={key} open={key === "executiveSummary"}>
                  <summary>
                    <span>{label}</span>
                    {unavailable && <span className="section-flag">unavailable</span>}
                  </summary>
                  {renderValue(value)}
                </details>
              );
            })}

          {report?.agentStatus && (
            <p className="muted-note">
              Agent status recorded with the report:{" "}
              {Object.entries(report.agentStatus)
                .map(([agent, status]) => `${agent}=${status}`)
                .join(" · ")}
            </p>
          )}
        </article>
      </div>

      {evidence?.items?.length > 0 && (
        <article className="panel evidence-panel">
          <div className="panel-head">
            <div>
              <span className="section-kicker">EVIDENCE</span>
              <h2>Sources used for this report</h2>
            </div>
            <span className="chip">{evidence.items.length} items</span>
          </div>
          <ul className="evidence-list">
            {evidence.items.map((item) => (
              <li key={item.evidenceId}>
                <div className="evidence-head">
                  <span className="evidence-source">{item.publisher}</span>
                  <span className="evidence-type">{item.sourceType}</span>
                  {item.duplicateCount > 1 && <span className="chip muted">{item.duplicateCount} copies</span>}
                  {item.metadata?.injectionSignals?.length > 0 && (
                    <span className="chip warning" title="Text contained instruction-like content and was treated as data">
                      flagged text
                    </span>
                  )}
                </div>
                <p>{item.excerpt || "No excerpt was supplied."}</p>
                <small>
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer noopener">
                      {item.url}
                    </a>
                  ) : (
                    "no url"
                  )}{" "}
                  · published {formatTime(item.publishedAt)} · retrieved {formatTime(item.retrievedAt)}
                </small>
              </li>
            ))}
          </ul>
        </article>
      )}

      <article className="panel jobs-panel">
        <div className="panel-head">
          <div>
            <span className="section-kicker">HISTORY</span>
            <h2>Recent jobs</h2>
          </div>
          <span className="chip">newest first</span>
        </div>
        {jobs.length ? (
          <table className="jobs-table">
            <thead>
              <tr>
                <th>JOB</th>
                <th>INSTRUMENT</th>
                <th>DEPTH</th>
                <th>STATUS</th>
                <th>GATE</th>
                <th>UPDATED</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jobs.map((entry) => (
                <tr key={entry.jobId}>
                  <td className="mono">{entry.jobId.slice(0, 18)}…</td>
                  <td>{entry.instrumentId}</td>
                  <td>{entry.depth}</td>
                  <td>
                    <span className={`job-chip ${entry.status.toLowerCase()}`}>{entry.status}</span>
                  </td>
                  <td>{entry.gateVerdict ? <GateBadge verdict={entry.gateVerdict} /> : "—"}</td>
                  <td>{formatTime(entry.updatedAt)}</td>
                  <td>
                    <button className="text-action" onClick={() => watch(entry.jobId, entry)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted-note">No research jobs yet.</p>
        )}
      </article>
    </section>
  );
}
