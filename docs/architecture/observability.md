# Observability

## What exists today

| Signal | Where | Notes |
| --- | --- | --- |
| AI usage per agent | `server/ai/usage.js` (`getUsageSnapshot`) | Tokens per model/agent, in-process |
| Provider failures | API `details[]`, job `dataWarnings` | Provider id + message, no secrets |
| Job lifecycle | `research_job_events` (PostgreSQL) or in-memory history | Every transition with timestamp and reason |
| Agent runs | `agent_runs` table / job detail | Status, attempts, duration, prompt/schema versions, error |
| Gate decisions | `job.gate` + report `checks[]` | Rule-level pass/warn/block with detail |
| Worker progress | `scripts/worker.js` stdout | One line per processed job |
| Health | `GET /api/health`, `/api/provider-status` | Configuration and verification levels |

Every response carries `retrievedAt` and every report carries engine versions
(`orchestrator`, `envelope`, `indicators`, `patterns`, `gateRules`, `reportBuilder`),
so a stored report can be explained after the code changes.

## What is missing

- Request ids and a structured log sink (JSON lines with `requestId`, route,
  latency, status, provider attempts).
- Provider latency/error-rate metrics over time.
- Cost dashboards for Groq usage (per job, per agent).
- Alerting on gate-block rate, worker queue depth and provider 5xx spikes.
- Client error reporting.

## Recommended shape

1. Emit one structured log line per request from the API adapter, including
   `requestId` (generated at the edge or in the adapter), route, status, duration
   and provider attempt count.
2. Emit one line per job transition and per agent run, tagged with `jobId`.
3. Ship logs to the platform's log drain; derive metrics from the same lines rather
   than adding a second instrumentation path.
4. Add `/api/health` latency probes for each configured provider (cached, with a
   short TTL) so the status endpoint reports measured availability, not just keys.
5. Store `usage` per agent run (already in the run payload) and aggregate per job for
   cost reporting.

## Privacy

Evidence excerpts and report text are derived from public sources, but they are
still user-requested research: do not log full excerpts. Log evidence ids, counts
and publishers.
