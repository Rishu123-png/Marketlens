import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/terminal/Icon.jsx";
import TerminalPanel from "../components/terminal/TerminalPanel.jsx";
import AgentStatus from "../components/terminal/AgentStatus.jsx";
import ResearchScenario from "../components/terminal/ResearchScenario.jsx";
import EvidenceBadge from "../components/terminal/EvidenceBadge.jsx";
import EmptyState from "../components/terminal/EmptyState.jsx";
import DataStatus from "../components/terminal/DataStatus.jsx";
import InstrumentSearch from "../components/InstrumentSearch.jsx";
import { api, formatTime } from "../lib/api.js";
import { defaultInstrument } from "../lib/instruments.js";
import { canPublishReport } from "../lib/researchGate.js";
import { quoteState } from "../lib/marketVisuals.js";

const AGENTS = ["chart", "technical", "news", "sentiment", "risk", "coordinator"];
const DEPTHS = [
  ["quick", "Quick", "Chart + technical + risk"],
  ["standard", "Standard", "Adds verified news"],
  ["comprehensive", "Comprehensive", "Adds sentiment"]
];
const TERMINAL = ["COMPLETED", "PARTIAL", "BLOCKED", "FAILED", "CANCELLED"];
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

function parseScenarios(text) {
  if (!text || typeof text !== "string") return null;
  const output = {};
  for (const tone of ["Bullish", "Bearish", "Neutral"]) {
    const start = text.indexOf(`${tone} scenario:`);
    if (start < 0) continue;
    const rest = text.slice(start + `${tone} scenario:`.length);
    const next = ["Bullish", "Bearish", "Neutral"]
      .map((label) => rest.indexOf(`${label} scenario:`))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0];
    const end = next ?? rest.indexOf("These are conditional");
    const body = rest.slice(0, end > 0 ? end : undefined).trim();
    const thesisMatch = body.match(/^([\s\S]*?)(?:\nEvidence:|\nUncertainty:|$)/);
    const conditionsMatch = body.match(/Conditions:\s*([^\n]+)/);
    const invalidationMatch = body.match(/Invalidation:\s*([^\n]+)/);
    const evidenceMatch = body.match(/Evidence:\s*([^\n.]+)/);
    output[tone.toLowerCase()] = {
      text: thesisMatch?.[1]?.trim() || body,
      conditions: conditionsMatch?.[1]
        ? conditionsMatch[1].replace(/\.$/, "").split(/;\s*/).filter(Boolean)
        : [],
      invalidation: invalidationMatch?.[1]?.replace(/\.$/, "") || null,
      evidenceIds: evidenceMatch?.[1]
        ? evidenceMatch[1].split(/,\s*/).map((value) => value.trim()).filter((value) => value && value !== "no direct evidence id")
        : []
    };
  }
  return Object.keys(output).length ? output : null;
}

function gateTone(verdict) {
  if (verdict === "PASS") return "ok";
  if (verdict === "PASS_WITH_WARNINGS") return "warn";
  if (!verdict) return "muted";
  return "bad";
}

export default function Research({ focus, onNavigate, defaultExchange = "NSE", defaultDepth = "standard" }) {
  const initial = focus?.symbol ? focus : defaultInstrument(defaultExchange);
  const [symbol, setSymbol] = useState(initial.symbol.replace(/^\^/, ""));
  const [exchange, setExchange] = useState(initial.exchange || defaultExchange);
  const [depth, setDepth] = useState(defaultDepth);
  const [job, setJob] = useState(null);
  const [report, setReport] = useState(null);
  const [agentRuns, setAgentRuns] = useState({});
  const [evidence, setEvidence] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const pollRef = useRef(null);
  const pollGeneration = useRef(0);
  const pollAbort = useRef(null);

  function stopPolling() {
    pollGeneration.current += 1;
    window.clearTimeout(pollRef.current);
    pollRef.current = null;
    pollAbort.current?.abort();
    pollAbort.current = null;
  }

  useEffect(() => {
    let cancelled = false;
    api("/api/jobs")
      .then((data) => { if (!cancelled) setJobs(data.jobs || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [job?.status]);

  useEffect(() => () => stopPolling(), []);

  function applyDetail(detail) {
    setJob(detail.job);
    setAgentRuns(detail.agentRuns || {});
    setReport(detail.report || null);
    setEvidence(detail.evidence || null);
    setSnapshot(detail.dataSnapshot || null);
    setWarnings(detail.dataWarnings || []);
    setError(detail.error ? { message: String(detail.error) } : null);
  }

  function watch(id, initial) {
    stopPolling();
    const generation = pollGeneration.current;
    setJob(initial);
    // Serial requests avoid an older, slower RUNNING response overwriting a
    // later terminal result. Selecting another job aborts the old request.
    const poll = async () => {
      const controller = new AbortController();
      pollAbort.current = controller;
      try {
        const detail = await api(`/api/jobs/${encodeURIComponent(id)}`, { signal: controller.signal });
        if (generation !== pollGeneration.current) return;
        applyDetail(detail);
        if (!TERMINAL.includes(detail.job.status)) pollRef.current = window.setTimeout(poll, 3000);
      } catch (pollError) {
        if (generation === pollGeneration.current) setError({ message: pollError.message, status: pollError.status });
      }
    };
    pollRef.current = window.setTimeout(poll, 3000);
  }

  async function startResearch(event) {
    event?.preventDefault();
    const clean = symbol.trim().toUpperCase();
    if (!clean) {
      setError({ message: "Enter a catalogued symbol to research." });
      return;
    }
    stopPolling();
    const generation = pollGeneration.current;
    setBusy(true);
    setError(null);
    setNotice(null);
    setReport(null);
    setEvidence(null);
    setSnapshot(null);
    setAgentRuns({});
    setWarnings([]);
    setJob(null);
    try {
      const created = await api("/api/research", { method: "POST", body: { symbol: clean, exchange, depth } });
      if (generation !== pollGeneration.current) return;
      watch(created.jobId, {
        jobId: created.jobId,
        status: created.status,
        depth: created.depth,
        instrumentId: created.instrumentId,
        createdAt: new Date().toISOString()
      });
      if (created.queue?.queue === "memory") {
        setWarnings(["The memory queue and job store are process-local. npm run dev starts a local worker in the API process; other deployments need a worker with access to the same store. QStash delivery requires configuration."]);
      }
      setNotice(`Research job ${created.jobId} created. Agents run in the background worker.`);
    } catch (createError) {
      if (generation === pollGeneration.current) setError({ message: createError.message, status: createError.status, details: createError.details });
    } finally {
      setBusy(false);
    }
  }

  async function openJob(entry) {
    setError(null);
    setNotice(null);
    stopPolling();
    const generation = pollGeneration.current;
    const controller = new AbortController();
    pollAbort.current = controller;
    try {
      const detail = await api(`/api/jobs/${encodeURIComponent(entry.jobId)}`, { signal: controller.signal });
      if (generation !== pollGeneration.current) return;
      applyDetail(detail);
      if (!TERMINAL.includes(detail.job.status)) watch(entry.jobId, detail.job);
    } catch (cause) {
      if (generation === pollGeneration.current) setError({ message: cause.message, status: cause.status });
    }
  }

  async function retry() {
    if (!job?.jobId) return;
    stopPolling();
    const generation = pollGeneration.current;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/jobs/${encodeURIComponent(job.jobId)}`, { method: "POST" });
      if (generation !== pollGeneration.current) return;
      watch(job.jobId, { ...job, status: "QUEUED", gate: null });
      setNotice("Job re-queued. Previous agent runs and report are retained.");
    } catch (cause) {
      if (generation === pollGeneration.current) setError({ message: cause.message, status: cause.status });
    } finally {
      setBusy(false);
    }
  }

  const running = job && !TERMINAL.includes(job.status);
  const gate = job?.gate ?? null;
  // The backend retains blocked artefacts for audit. They must not be presented
  // as a published narrative or scenarios unless both stored gates agree.
  const publishedReport = canPublishReport(report, job) ? report : null;
  const gateMismatch = Boolean(report?.gate?.verdict && gate?.verdict && report.gate.verdict !== gate.verdict);
  const gateLabel = gateMismatch ? "GATE MISMATCH" : report && !publishedReport && gate?.verdict !== "BLOCKED" ? "GATE UNCONFIRMED" : gate?.verdict?.replaceAll("_", " ") || "NO GATE VERDICT";
  const scenarios = useMemo(() => parseScenarios(publishedReport?.sections?.scenarios), [publishedReport]);
  const completed = Object.values(agentRuns).filter((run) => run.status === "COMPLETED").length;
  const evidenceCount = evidence?.items?.length ?? report?.evidenceIds?.length ?? 0;

  return (
    <section className="workspace research-workspace">
      <header className="workspace-head">
        <div>
          <span className="workspace-kicker">AI ANALYST · SIX-AGENT RESEARCH</span>
          <h1>AI Analyst</h1>
          <p>Evidence-linked research. The deterministic gate decides publication; agents never source prices or candles.</p>
        </div>
        <div className="workspace-head-actions">
          <span className={`gate-pill ${gateMismatch || (report && !publishedReport && gate?.verdict !== "BLOCKED") ? "bad" : gateTone(gate?.verdict)}`}><Icon name="shield" size={12} /> {gateLabel}</span>
          <span className="head-date">{job ? `${completed}/6 agents complete` : "No active job"}</span>
        </div>
      </header>

      <TerminalPanel className="research-control-panel" bodyClassName="research-control-body">
        <form onSubmit={startResearch} className="research-controls">
          <label className="field symbol-field">
            <span>INSTRUMENT</span>
            <input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} placeholder="TCS" autoComplete="off" />
          </label>
          <label className="field">
            <span>EXCHANGE</span>
            <select value={exchange} onChange={(event) => setExchange(event.target.value)}>
              {["NSE", "BSE", "NASDAQ", "NYSE"].map((venue) => <option key={venue}>{venue}</option>)}
            </select>
          </label>
          <div className="field depth-field">
            <span>RESEARCH DEPTH</span>
            <div className="depth-segment">
              {DEPTHS.map(([value, label, hint]) => (
                <button key={value} type="button" className={depth === value ? "active" : ""} onClick={() => setDepth(value)} title={hint}>{label}</button>
              ))}
            </div>
          </div>
          <div className="research-search"><InstrumentSearch compact onSelect={(instrument) => { setSymbol(instrument.symbol.replace(/^\^/, "")); setExchange(instrument.exchange); }} placeholder="Look up a catalogued symbol…" /></div>
          <button type="submit" className="t-btn primary research-run" disabled={busy || running}>
            <Icon name={busy || running ? "refresh" : "sparkle"} size={13} className={busy || running ? "spin" : ""} />
            {busy ? "Creating…" : running ? "Research running…" : "Generate report"}
          </button>
        </form>
        <div className="research-control-meta">
          <span>{DEPTHS.find(([value]) => value === depth)?.[2]}</span>
          <span>Six agents · depth-dependent</span>
          <span>No network tools inside agent prompts</span>
          <span>Dedicated Groq routing preserved</span>
        </div>
      </TerminalPanel>

      {error && (
        <div className="inline-alert error" role="alert">
          <Icon name="warn" size={15} />
          <div><strong>{error.status === 503 ? "Research service not configured" : "Research unavailable"}</strong><span>{error.message}</span></div>
          {job && ["FAILED", "BLOCKED"].includes(job.status) && <button type="button" onClick={retry} disabled={busy}>Retry job</button>}
          {job && !TERMINAL.includes(job.status) && <button type="button" onClick={() => openJob(job)}>Reconnect to job</button>}
        </div>
      )}
      {notice && <div className="inline-alert info"><Icon name="info" size={15} /><div><strong>Research</strong><span>{notice}</span></div></div>}
      {warnings.length > 0 && (
        <div className="inline-alert info"><Icon name="info" size={15} /><div><strong>Worker notes</strong>{warnings.map((line, index) => <span key={index}>{line}</span>)}</div></div>
      )}

      <div className="research-grid">
        <div className="research-left">
          <TerminalPanel
            kicker="EXECUTION"
            title="Agent status"
            actions={<span className={`job-pill ${(job?.status || "IDLE").toLowerCase()}`}>{job?.status || "IDLE"}</span>}
            className="agent-panel"
          >
            <div className="research-job-meta">
              <div><span>JOB</span><strong>{job?.jobId?.slice(0, 20) || "Not started"}</strong></div>
              <div><span>INSTRUMENT</span><strong>{job?.instrumentId || `${symbol} · ${exchange}`}</strong></div>
              <div><span>DEPTH</span><strong>{job?.depth || depth}</strong></div>
              <div><span>UPDATED</span><strong>{job?.updatedAt ? formatTime(job.updatedAt) : "—"}</strong></div>
            </div>
            <div className="agent-list">
              {AGENTS.map((agent) => <AgentStatus key={agent} agent={agent} run={agentRuns[agent]} depth={job?.depth} />)}
            </div>
            {job?.status === "QUEUED" && <p className="inline-note">Waiting for a worker with access to this job store. npm run dev starts a local worker; a separate process cannot read an in-memory store.</p>}
            {running && <><div className="progress-line"><i /></div><p className="inline-note">Agent run details are persisted when the worker finishes; the job status is polled while it runs.</p></>}
            {job && ["FAILED", "BLOCKED"].includes(job.status) && <button type="button" className="t-btn secondary full" onClick={retry} disabled={busy}>Retry job</button>}
            {gate?.blocking?.length > 0 && (
              <div className="blocking-list">
                <span>BLOCKING FINDINGS</span>
                {gate.blocking.slice(0, 5).map((finding, index) => <p key={index}><b>{finding.rule}</b> {finding.message}</p>)}
              </div>
            )}
          </TerminalPanel>

          <TerminalPanel kicker="RESEARCH HISTORY" title="Recent jobs" className="job-history-panel">
            {jobs.length ? (
              <div className="job-history-list">
                {jobs.slice(0, 7).map((entry) => (
                  <button key={entry.jobId} type="button" className="job-history-row" onClick={() => openJob(entry)}>
                    <span><strong>{entry.instrumentId}</strong><small>{entry.depth} · {formatTime(entry.updatedAt)}</small></span>
                    <span className={`job-pill ${entry.status.toLowerCase()}`}>{entry.status}</span>
                    <Icon name="chevronRight" size={12} />
                  </button>
                ))}
              </div>
            ) : <EmptyState compact icon="ai" title="No research jobs" detail="Create a job to see its evidence trail here." />}
          </TerminalPanel>
        </div>

        <div className="research-center">
          <TerminalPanel
            kicker="SCENARIO DEBATE"
            title="Bull · Bear · Neutral"
            actions={<EvidenceBadge tone="ai">Conditional interpretation</EvidenceBadge>}
            className="scenario-panel"
          >
            <p className="panel-intro">The coordinator reads the same supplied evidence three ways. These are conditional interpretations, not probabilities or forecasts.</p>
            <div className="scenario-grid">
              {["bullish", "bearish", "neutral"].map((tone) => (
                <ResearchScenario
                  key={tone}
                  tone={tone}
                  text={scenarios?.[tone]?.text}
                  conditions={scenarios?.[tone]?.conditions}
                  invalidation={scenarios?.[tone]?.invalidation}
                  evidenceIds={scenarios?.[tone]?.evidenceIds}
                  unavailable={!scenarios?.[tone]}
                />
              ))}
            </div>
          </TerminalPanel>

          <TerminalPanel
            kicker={report && !publishedReport ? "PUBLICATION WITHHELD" : "PUBLISHED REPORT"}
            title={publishedReport?.reportId || (report ? "Report withheld" : "Final report")}
            actions={publishedReport ? <span className="report-meta"><DataStatus state={{ code: gate?.verdict === "PASS" ? "ok" : "delayed", label: gate?.verdict }} compact /> {publishedReport.sections?.methodology ? "methodology attached" : null}</span> : null}
            className="report-panel"
          >
            {!publishedReport && (
              <EmptyState
                icon="ai"
                title={report ? "Report withheld by the publication gate" : "No published report yet"}
                detail={report ? "The stored artefact is not published because the job and report gates are blocked, missing or inconsistent, or the run is not complete. Inspect the gate findings before retrying." : "Sections appear only when the deterministic gate permits publication. Missing agents stay missing; they are not invented."}
                action={!report ? <button type="button" className="t-btn secondary sm" onClick={startResearch} disabled={busy || running}>Generate research</button> : null}
              />
            )}
            {publishedReport && (
              <div className="report-accordion">
                {SECTION_ORDER.map(([key, label]) => {
                  const value = publishedReport.sections?.[key];
                  if (value === undefined) return null;
                  const unavailable = typeof value === "string" && value.startsWith("Section unavailable");
                  return (
                    <details key={key} open={key === "executiveSummary"}>
                      <summary><span>{label}</span>{unavailable && <b className="unavailable-flag">UNAVAILABLE</b>}<Icon name="chevronDown" size={12} /></summary>
                      <div className="report-copy">
                        {Array.isArray(value)
                          ? value.length ? <ul>{value.map((entry, index) => <li key={index}>{String(entry)}</li>)}</ul> : <p>None recorded.</p>
                          : <p>{String(value)}</p>}
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </TerminalPanel>
        </div>

        <div className="research-right">
          <TerminalPanel kicker="INDEPENDENT REVIEW" title="Risk assessment" className="risk-panel" actions={<EvidenceBadge tone={report && !publishedReport ? "unavailable" : "unverified"}>{report && !publishedReport ? "Withheld" : "AI review"}</EvidenceBadge>}>
            {publishedReport?.sections?.risk ? (
              <div className="risk-copy">{String(publishedReport.sections.risk).split("\n").filter(Boolean).map((line, index) => <p key={index}>{line}</p>)}</div>
            ) : <EmptyState compact icon="shield" title={report ? "Risk narrative withheld" : "Risk review pending"} detail={report ? "Consult the deterministic gate findings in the agent status panel." : "The risk agent reviews completeness, freshness and unsupported claims before the coordinator."} />}
            <div className="risk-checks">
              <div><span>Completeness</span><b>{agentRuns.risk?.status === "COMPLETED" ? "REVIEWED" : "PENDING"}</b></div>
              <div><span>Data freshness</span><b>{publishedReport ? "STATED IN REPORT" : report ? "WITHHELD" : "PENDING"}</b></div>
              <div><span>Unsupported claims</span><b>{gate?.warnings?.length ?? "—"} gate warnings</b></div>
            </div>
          </TerminalPanel>

          <TerminalPanel kicker="DATA COVERAGE" title="Research inputs" className="research-coverage-panel">
            <div className="kv-list">
              <div><span>Quote</span>{snapshot ? <DataStatus state={quoteState(snapshot.quote)} compact /> : <strong>pending</strong>}</div>
              <div><span>Quote source</span><strong>{snapshot?.quote?.source || "—"}</strong></div>
              <div><span>Historical candles</span><strong>{snapshot ? snapshot.candles ? `${snapshot.candles.count} · ${snapshot.candles.interval}` : "unavailable" : "pending"}</strong></div>
              <div><span>Candle source</span><strong>{snapshot?.candles?.source || "—"}</strong></div>
              <div><span>Evidence items</span><strong>{snapshot ? snapshot.evidence?.items?.length ?? 0 : "—"}</strong></div>
              <div><span>Gate checks</span><strong>{gate?.checks?.length ?? "—"}</strong></div>
            </div>
            {gate?.checks?.length > 0 && <details className="run-coverage-details"><summary>Inspect gate checks</summary><ul className="limitation-list">{gate.checks.map((check, index) => <li key={`${check.rule}-${index}`}><b>{check.status.toUpperCase()} · {check.rule}</b> — {check.detail}</li>)}</ul></details>}
            <p className="provenance-note">These are the stored inputs for this run, not a claim of current market-wide coverage.</p>
            <button type="button" className="t-link" onClick={() => onNavigate("coverage")}>Open market data coverage <Icon name="arrowRight" size={12} /></button>
          </TerminalPanel>

          <TerminalPanel kicker="EVIDENCE REFERENCES" title={`${evidenceCount} linked item(s)`} className="evidence-panel" actions={<EvidenceBadge tone="unverified">Source references</EvidenceBadge>}>
            {evidence?.items?.length ? (
              <div className="evidence-compact-list">
                {evidence.items.slice(0, 6).map((item) => (
                  <a key={item.evidenceId || item.id} href={item.url || undefined} target="_blank" rel="noreferrer noopener" className={!item.url ? "is-disabled" : ""}>
                    <span className="evidence-source-mark">{item.publisher?.slice(0, 2)?.toUpperCase() || "EV"}</span>
                    <span><strong>{item.metadata?.title || item.excerpt?.slice(0, 80) || "Evidence item"}</strong><small>{item.publisher} · {formatTime(item.publishedAt || item.retrievedAt)}</small></span>
                    {item.url ? <Icon name="external" size={11} /> : <span className="no-url">no url</span>}
                  </a>
                ))}
              </div>
            ) : (
              <EmptyState compact icon="news" title="No evidence attached" detail={report ? "The report records no external evidence IDs." : "Evidence appears when a report is published."} />
            )}
            {report?.evidenceIds?.length > 0 && <div className="evidence-id-row">{report.evidenceIds.slice(0, 8).map((id) => <span key={id}>{id}</span>)}</div>}
          </TerminalPanel>

          <TerminalPanel kicker="REPRODUCIBILITY" title="Stored artefact" className="repro-panel">
            <div className="kv-list">
              <div><span>Report ID</span><strong>{report?.reportId || "—"}</strong></div>
              <div><span>Created</span><strong>{report?.createdAt ? formatTime(report.createdAt) : "—"}</strong></div>
              <div><span>Evidence IDs</span><strong>{report?.evidenceIds?.length ?? 0}</strong></div>
              <div><span>Gate warnings</span><strong>{gate?.warnings?.length ?? 0}</strong></div>
              <div><span>Replay</span><strong>{report ? "stored report available" : "not available"}</strong></div>
            </div>
            {report && <button type="button" className="t-btn secondary full" onClick={() => onNavigate("diagnostics")}>Open Diagnostics</button>}
            <p className="provenance-note"><Icon name="lock" size={11} /> Replay reads stored report and evidence. It does not fetch a new price series.</p>
          </TerminalPanel>
        </div>
      </div>
    </section>
  );
}
