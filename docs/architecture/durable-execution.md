# Durable execution and recovery

**Status:** implemented in code; PostgreSQL, QStash delivery and the worker endpoint
are **not yet live-verified** in this environment (see
`docs/verification/2026-11-12-production-readiness.md`).

## Components

| Layer | Implementation | Durable when |
| --- | --- | --- |
| Job store | `server/jobs/store.js` memory, `server/storage/pgJobStore.js` PostgreSQL | `DATABASE_URL` is set |
| Job queue | memory queue or QStash publish (`server/jobs/queue.js`) | `QSTASH_TOKEN` + HTTPS `WORKER_URL` are set |
| Worker auth | QStash HS256 signature, or `WORKER_SECRET` timing-safe fallback | signing key or worker secret is set |
| Reports | insert-only `reports` + `report_revisions`; `research_job_results` envelope | PostgreSQL |
| Ownership | SHA-256 of the browser bearer value (`owner_hash`) | PostgreSQL; memory store supports it per process |
| Provider policy | quota/circuit ledger (`server/market-data/providerPolicy.js`) | Upstash Redis when configured, otherwise per instance |

## State machine

```
CREATED → VALIDATING → QUEUED → RUNNING → COMPLETED
                                      → PARTIAL
                                      → BLOCKED
                                      → FAILED
                                      → CANCELLED
FAILED/BLOCKED ── explicit POST /api/jobs/:id retry ──→ QUEUED
```

`BLOCKED`, `COMPLETED`, `PARTIAL`, `FAILED` and `CANCELLED` are terminal for normal
transitions. A retry uses a dedicated function (`retryJob`) rather than a generic
terminal transition, clears the old gate, and appends a `FAILED/BLOCKED → QUEUED`
event with the reason. Retries are never automatic.

## Persistence model

- `research_jobs` — current state, gate, owner hash.
- `research_job_events` — append-only transition history.
- `agent_runs` — one row per `(job_id, agent)`; a QStash redelivery updates rather
  than duplicates.
- `reports` — immutable report rows; a correction is a new row + `report_revisions`.
- `research_job_results` — status, gate, versions, data warnings, compact evidence
  and error, so `GET /api/jobs/:id` survives a page refresh and a fresh instance.
- `evidence_items` — excerpt and retrieval time exactly as observed.

A worker redelivery for a terminal job returns `200 { skipped: true }`; a delivery
for a job already `RUNNING` also acknowledges without starting a second run.

## Failure and recovery semantics

| Failure | Behaviour |
| --- | --- |
| Provider quota/403/5xx | Provider circuit opens with a reason and retry time; other providers are tried; no fabricated data |
| Worker throws | Job becomes `FAILED` with a stored error; owner may retry explicitly |
| Gate blocks | Job becomes `BLOCKED`; report/runs/gate remain visible; owner may fix inputs and retry |
| Worker process dies after claim | Job remains `RUNNING`; an operator can inspect the job. There is no automatic stale-claim reaper in this milestone. |
| QStash duplicate after completion | Acknowledged, not re-run |
| Queue publish fails | Job is marked `FAILED`; retry is available explicitly |
| Postgres unavailable | API returns an error rather than silently falling back to memory when `DATABASE_URL` is configured |

## Configuration checklist

1. `DATABASE_URL` (+ `DATABASE_SSL`), then run migrations on first request/worker boot.
2. `QSTASH_TOKEN`, `WORKER_URL` (HTTPS only).
3. `QSTASH_CURRENT_SIGNING_KEY` (+ next during rotation), or `WORKER_SECRET`.
4. `WORKER_URL` must point at `/api/worker` on a deployment that receives QStash.
5. `UPSTASH_REDIS_REST_URL/_TOKEN` for shared provider quota/circuit state.

Secrets are read server-side only and never returned by diagnostics.

## Known gaps

- No automatic stale-`RUNNING` recovery (`reaper`) yet; retry is explicit.
- No live PostgreSQL/QStash verification in this sandbox (no local Postgres/Docker).
- QStash signature verification depends on reconstructing the exact signed body when
  the runtime has already parsed JSON; it fails closed if reconstruction differs.
