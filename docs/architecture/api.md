# API reference

All routes are same-origin under `/api`, rate limited per client, and return JSON.
No route accepts a price from the browser: every number in a response was fetched
or calculated server-side. There is deliberately no `/v1` prefix (decision O4).

| Route | Method | Purpose | Notes |
| --- | --- | --- | --- |
| `/api/health` | GET | Liveness + configured capabilities | Never exposes key values |
| `/api/instruments` | GET | Instrument catalog | `country`, `exchange`, `assetType`, `sector`, `q`, `id`, `limit`, `offset` |
| `/api/universe` | GET | Curated popular list | Used by the Overview screen |
| `/api/search` | GET | Provider symbol search | `q` (≥2 chars) |
| `/api/market` | GET | Verified quote | 503 when no provider can verify |
| `/api/top-stocks` | GET | Batch quotes | Bounded concurrency, partial results |
| `/api/history` | GET | Historical candles | `symbol`, `exchange`, `interval`, `limit` |
| `/api/indicators` | GET | Deterministic indicator snapshot | Includes engine version + parameters |
| `/api/analysis` | GET | Candles + indicators + chart structure | **No AI**; used by Chart Lab |
| `/api/news` | GET | News + filing evidence | `symbol`, `exchange`, `q`, `limit`, `filings=false` |
| `/api/coverage` | GET | Which evidence capabilities are available, partial, degraded or unavailable | 60 s cache; never echoes values |
| `/api/nav` | GET | Official AMFI end-of-day NAV | `isin` or `schemeCode`; `delayed: true` |
| `/api/official-data` | GET | data.gov.in OGD records | `resource`, `limit`, `offset`, `filters`; 503 without `DATA_GOV_IN_API_KEY` |
| `/api/provider-status` | GET | Capability, configuration and verification levels | Includes storage + queue status |
| `/api/report` | POST | Single-shot AI commentary on a verified quote | Legacy quick path; one model call |
| `/api/research` | POST | Create a durable research job | 202 with `jobId`; never runs agents in-request |
| `/api/jobs` | GET | List recent jobs | `limit`, `status` |
| `/api/jobs/[jobId]` | GET | Job status, agent runs, report, evidence | Poll until terminal |
| `/api/jobs/[jobId]` | DELETE | Cancel a job | Legal transitions only |
| `/api/worker` | POST | Queue delivery entry point | Requires `WORKER_SECRET` |

## Research job flow

```
POST /api/research            → 202 { jobId, status: QUEUED, poll }
worker (queue delivery)       → RUNNING
GET /api/jobs/:jobId          → COMPLETED | PARTIAL | BLOCKED | FAILED
                              → { job, agentRuns, report, gate, evidence }
```

`BLOCKED` means the deterministic gate refused publication. The report, agent runs
and gate checks are still returned so the reason is visible — never published as a
finished report.

## Error shape

```json
{ "error": "Human-readable message", "details": [...], "retryAfterSeconds": 30 }
```

- `400` invalid input (symbol, interval, depth).
- `404` unknown instrument/job/report.
- `405` wrong method.
- `429` rate limited, with `Retry-After`.
- `503` not configured (provider key, AI key, queue, worker secret).
- `500` internal failure; the message stays generic.

## Header and caching notes

- Provider-backed GETs are cached server-side for a few minutes; `cached` says whether
  the response came from that cache.
- `retrievedAt` is the time the server observed the data. It is always present on
  market-data, analysis and evidence responses.
