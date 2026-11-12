# Durable research execution — decision and cost model

Status: **decided, not implemented.** Nothing in this document is running yet.
It records the O1 decision, the reasoning, and what must be true before the
orchestrator (M5) is written.

## Decision (O1, 2026-11-12)

Research jobs execute on a **durable queue with an independently deployed
worker**. QStash is the candidate queue. Multi-agent execution must not run
inside a normal Vercel request.

Consequence for M1: the job lifecycle and schemas are written so a job can be
created, validated, queued, executed elsewhere and polled — but no queue client,
worker, cron or job table is added in M1. The runtime stays exactly as it is
today.

## Why in-request execution is rejected

| Constraint | Number |
| --- | --- |
| Vercel function ceiling on the current plan | 60 s (`api/report.js`, `api/top-stocks.js` already at the cap) |
| Agents per comprehensive job | 5 specialists + coordinator + 2 risk passes |
| Worst case with one retry each | ≥ 6 × (provider latency + backoff), well past 60 s |
| Failure mode | Function killed mid-job: no report, no record, wasted tokens |

A single-prompt endpoint can fit in 60 s. A research job cannot, and pretending
otherwise would mean shipping a system that fails exactly when a user waits
longest.

## Options considered

| Option | Fit | Verdict |
| --- | --- | --- |
| A. In-request execution | Simple, no infra | **Rejected** — time ceiling, no resumption, tokens wasted on timeout |
| B. Queue (QStash) + independent worker | Durable, retries, independent scaling | **Chosen** — with the conditions below |
| C. Vercel cron + job table worker | No new vendor | Fallback if queue cost/latency is unacceptable; 1-min granularity adds latency |
| D. Managed queue (SQS/Cloud Tasks) + container | Most control | Future — more setup than the current stage justifies |

## Target flow (M5)

```
POST /api/research
  1. validate instrument + depth (shared/schemas)
  2. create job row  → status CREATED → VALIDATING
  3. assemble evidence (quotes, candles, indicators, news)
  4. deterministic pre-checks → BLOCKED or QUEUED
  5. enqueue { jobId, attempt, signature }            ← QStash
  6. return 202 { jobId }

worker (separate deployment)
  7. verify signature, load job, assert QUEUED → RUNNING
  8. run specialists per graph (chart ∥ technical; news → sentiment)
  9. risk post-review → coordinator → deterministic gate
 10. persist report + agent runs + evidence links
 11. job → COMPLETED | PARTIAL | BLOCKED | FAILED        ← never inferred

client polls GET /api/research/:jobId every 2–5 s (SSE later)
```

Rules:

- Job transitions go through `server/orchestrator/jobLifecycle.js`; an illegal
  move throws (tested).
- The gate verdict is applied with `applyGate`; a job cannot be marked COMPLETED
  without a non-blocking gate, and cannot be BLOCKED without a blocking one.
- Messages are idempotent: a duplicate delivery re-reads the job status and exits
  if it is already terminal or RUNNING elsewhere.
- Retries are bounded in the message policy; exhausted messages park the job as
  `FAILED` with the provider error recorded.
- The worker is not publicly routable: it accepts only signed queue deliveries.

## Cost model

Prices change and must be confirmed on each provider's pricing page before
budgeting — they are deliberately **not** quoted here as fact.

| Cost line | Driver | Scales with |
| --- | --- | --- |
| Queue messages | 1 enqueue + retries per job | jobs × attempts |
| Worker compute | agent wall-clock ÷ concurrency | jobs × agent latency |
| LLM tokens | prompt + completion per agent | jobs × depth (Quick ≪ Comprehensive) |
| Database | job/agent/evidence/report rows | jobs (retention policy needed) |
| Upstash (rate limits) | requests per API call | API traffic |

Budget guardrails to implement with M5: per-depth token caps, per-user daily job
limits, a hard concurrency limit on the worker, and usage recorded per agent run
(`server/ai/usage.js` already tracks tokens per agent/model in-process).

## Worker hosting options (to confirm at M5)

| Option | Note |
| --- | --- |
| Container on Fly/Render/Railway | Long-lived process, simple `node server/worker.js`, needs secrets management |
| Vercel background function | Still a function; verify the actual duration limit for the plan |
| GitHub Actions runner as worker | Free-ish but wrong scheduling semantics for user requests — not recommended |

## Environment variables to add at M5

```
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
WORKER_BASE_URL=
DATABASE_URL=
```

None are read by the current code. Adding them to `.env.example` before the code
exists would imply a feature that is not there; they will be added with the
implementation.

## What M1 delivered towards this

- `shared/schemas/research.js` — job/report shapes, statuses, depths, required
  modules per depth.
- `server/orchestrator/jobLifecycle.js` — the only legal way to move a job,
  including gate consistency, with 13 tests covering every transition.
- `server/reports/gate.js` — the deterministic publication decision the worker
  will call, with 32 tests.

Nothing in M1 performs I/O beyond the existing endpoints.
