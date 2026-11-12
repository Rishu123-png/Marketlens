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
| Vercel function ceiling on the current plan | 60 s for the single `api/index.js` function (Hobby) |
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

## Implemented execution path (M5)

```
POST /api/research
  ├─ validate depth/symbol, require GROQ_API_KEY
  ├─ create job (CREATED → VALIDATING → QUEUED)
  └─ publish { jobId } to the queue
        ├─ memory queue  → same-process worker (`npm run worker`)
        └─ QStash        → WORKER_URL (POST /api/worker, x-worker-secret)
worker (JobRunner)
  ├─ claim QUEUED → RUNNING
  ├─ run orchestrator (data → agents → gate → report)
  ├─ persist agent runs + report + evidence
  └─ COMPLETED | PARTIAL | BLOCKED | FAILED
GET /api/jobs/:jobId  → poll until terminal
```

Configuration:

| Variable | Purpose |
| --- | --- |
| `QSTASH_TOKEN` | Publish jobs to QStash |
| `WORKER_URL` | Public worker endpoint that receives the job id |
| `WORKER_SECRET` | Shared secret required by `/api/worker` |
| `WORKER_POLL_MS` | Poll interval for `npm run worker` |
| `DATABASE_URL` | Durable, shared job store (otherwise memory) |

Limits and gaps:

- The worker route sets `maxDuration: 300`. A comprehensive job with slow providers
  can approach that; the queue should be configured with a retry policy.
- QStash request-signature verification is not implemented; the shared secret is the
  current control.
- Without `DATABASE_URL`, the memory store is process-local: the API cannot see a job
  created in another instance. This is stated in API responses (`note`) and in
  `provider-status`.

## Cost model (unchanged, restated)

Per comprehensive job: 6 agent calls (chart, technical, news, sentiment, risk,
coordinator) plus deterministic compute. Token ceilings come from
`server/ai/config.js` (900–2,400 output tokens per agent). Cost is bounded by
`maxOutputTokens` × model price; usage is recorded per agent so a job can be
costed after the fact. Retries are capped at one and never sleep longer than 5 s.

## Deployment checklist

1. Set provider keys (market data, Groq) as server-side environment variables.
2. Set `DATABASE_URL` (+ `DATABASE_SSL`) and run migrations
   (`node -e "import('./server/storage/index.js').then(m => m.getStorage())"`).
3. Deploy the worker (`npm run worker` on a long-running host, or `/api/worker`
   for queue deliveries) and set `WORKER_SECRET`.
4. Configure QStash with `QSTASH_TOKEN` + `WORKER_URL`.
5. Optionally configure `S3_*` for report artefacts.
6. Set `NEWS_*` and confirm official feeds before enabling them.
7. Verify: create a Quick job, confirm gate verdict, then a Comprehensive job.

## Vercel Hobby limits (why the deploy failed once)

The project runs on the Hobby plan, which has two hard limits that are enforced
at the deploy step, after a green local build:

| Limit | Error Vercel returns | Fix applied |
| --- | --- | --- |
| Max 12 Serverless Functions per deployment (every file under `api/` counts) | `No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan` | `api/` now holds one file, `api/index.js`; the 20 route handlers moved to `handlers/` and are dispatched through `server/http/router.js` |
| `maxDuration` must be 1–60 | `Builder returned invalid maxDuration value for Serverless Function` | `vercel.json` declares `maxDuration: 60` for `api/index.js`; the old `api/worker.js` entry asked for 300 |

Deployments from commit `526c94c` onward failed at `patchBuild` for these
reasons; production kept serving the previous build. `tests/unit/http-router.test.js`
and the function-budget assertion in `test/api-modules.test.js` fail locally if
either limit is crossed again, so a green `npm test` now covers what the build
alone did not.

Consequences to keep in mind:

- The worker must run outside Vercel (`npm run worker` on a long-running host).
  `/api/worker` still exists for queue delivery, but it is capped at 60 s.
- A slow `/api/analysis` request that exceeds 60 s will be killed by the
  platform; the route is deterministic and normally finishes in a few seconds.
- Long research runs stay in the worker, not in an HTTP request (O1).
