# API reference

All routes are same-origin under `/api`, rate limited per client, and return JSON.
No route accepts a price from the browser: every number in a response was fetched
or calculated server-side. There is deliberately no `/v1` prefix (decision O4).

| Route | Method | Purpose | Notes |
| --- | --- | --- | --- |
| `/api/health` | GET | Liveness + configured capabilities | Never exposes key values |
| `/api/instruments` | GET | Merged instrument master + availability | `q`, `country`, `exchange`, `assetType`, `sector`, `id`, `limit` (≤500), `offset`, `directory=0`, `refreshDirectory=1`, `coverage=1` |
| `/api/instruments?coverage=1` | GET | Instrument coverage matrix | Catalogued / quote-capable / verified / candle-capable, freshness, provider failures |
| `/api/universe` | GET | Curated popular list | Used by the Overview screen |
| `/api/search` | GET | Master search first, provider search second | `q` (≥2 chars), `limit` |
| `/api/market` | GET | Verified quote | 503 when no provider can verify |
| `/api/top-stocks` | GET | Batch quotes (legacy ranking) | Bounded concurrency, partial results, explicit coverage counts |
| `/api/market-overview` | GET | Indices, verified breadth, sectors, movers, heatmap, freshness | 90 s cache; never exchange-wide breadth |
| `/api/quotes` | GET | Batch verified quotes for watchlists/portfolios | `symbols` (≤24, `SYMBOL@EXCHANGE` keeps dual listings apart), per-symbol failures |
| `/api/screener` | GET | Quote + technical screener | Refuses market-cap filters; bounded technical evaluation |
| `/api/structure` | GET | BOS, CHoCH, order-block/FVG/equal-level/sweep hypotheses | `symbol`, `exchange`, `interval`, `limit` |
| `/api/history` | GET | Historical candles | `symbol`, `exchange`, `interval`, `limit` |
| `/api/indicators` | GET | Deterministic indicator snapshot | Includes engine version + parameters |
| `/api/analysis` | GET | Candles + indicators + chart structure + overlay series | **No AI**; intervals include `4h` (hourly aggregation); anchored VWAP |
| `/api/news` | GET | News + filing evidence | `symbol`, `exchange`, `q`, `limit`, `filings=false` |
| `/api/coverage` | GET | Which evidence capabilities are available, partial, degraded or unavailable | 60 s cache; includes runtime failure state; never echoes values |
| `/api/nav` | GET | Official AMFI end-of-day NAV | `isin` or `schemeCode`; `delayed: true` |
| `/api/official-data` | GET | data.gov.in OGD records | `resource`, `limit`, `offset`, `filters`; 503 without `DATA_GOV_IN_API_KEY` |
| `/api/provider-status` | GET | Capability, configuration and verification levels | Includes storage + queue status |
| `/api/report` | POST | Single-shot AI commentary on a verified quote | Legacy quick path; one model call |
| `/api/research` | POST | Create a durable research job | 202 with `jobId`; never runs agents in-request |
| `/api/jobs` | GET | List jobs owned by `x-owner-id` (legacy unowned only when absent) | `limit`, `status` |
| `/api/jobs/[jobId]` | GET | Job status, agent runs, report, evidence | Poll until terminal; 404 for a different owner |
| `/api/jobs/[jobId]` | DELETE | Cancel a job | Legal transitions only |
| `/api/worker` | POST | Queue delivery entry point | QStash signature (when signing keys set) or `WORKER_SECRET` |

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
- A research job owned by another browser identity returns `404`, never `403`:
  the API does not confirm that someone else's job exists.
- `500` internal failure; the message stays generic.

## Header and caching notes

- Provider-backed GETs are cached server-side for a few minutes; `cached` says whether
  the response came from that cache.
- `retrievedAt` is the time the server observed the data. It is always present on
  market-data, analysis and evidence responses.

## Routing and deployment shape

All routes below are served by a **single** Vercel Serverless Function,
`api/index.js`, through the static table in `server/http/router.js`. Handlers
live in `handlers/` because the Hobby plan caps a deployment at 12 functions and
every file under `api/` counts as one.

`vercel.json` rewrites `/api/:path*` → `/api?__path=:path*`. Outside Next.js,
`api/[...path].js` is compiled as a single-segment route, so the rewrite (not a
bracketed filename) is what makes nested paths like `/api/jobs/:id` work. The
entry point rebuilds `/api/<path>` from `__path`, validates it (no traversal,
no encoded separators), merges path params into `req.query`, and dispatches.

To add a route: create `handlers/<name>.js` exporting a default handler, add it
to the table in `server/http/router.js`, and extend the router test. Do **not**
add files under `api/` — the function-budget test fails if you do.
