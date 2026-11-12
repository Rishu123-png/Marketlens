# MarketLens

A research and educational market-intelligence terminal for Indian and global
markets. Deterministic code fetches and computes every number; six specialist AI
agents interpret that evidence — **Groq is the single AI provider for all six
agents**, report reasoning, classification and evidence interpretation; a
deterministic publication gate decides whether a report may be published. **No order execution, no price targets, no predictions.**

Three screens ship today:

- **Overview** — curated NSE list, provider search, watchlist, verified quote modal
  and single-shot AI commentary.
- **Chart Lab** — candlesticks and volume (Lightweight Charts) plus server-computed
  indicators, support/resistance zones, candlestick and chart patterns.
- **Research** — durable research jobs run by a background worker: gate verdict,
  per-agent status, ten-section report, evidence trail and recent jobs.

Chart Lab and Research both show an **evidence coverage strip** (`/api/coverage`):
quotes, candles, news, filings, NAV and macro are each marked available, partial,
degraded or unavailable, with the reason. Missing data is never silently omitted.

## Quick start

```bash
npm ci
cp .env.example .env.local     # add provider keys as needed
npm run dev                    # Vite on 0.0.0.0:5173 + local API on 127.0.0.1:8787
```

The app loads without any keys; every provider-backed screen then fails honestly
with a configuration message instead of showing estimated data.

```bash
npm run check    # parse-only syntax guard (api/, server/, lib/, scripts/, tests/, src/)
npm test         # Node test runner: unit + endpoint suites
npm run build    # production client build
npm audit        # dependency audit
npm run worker   # background research worker (polling)
```

## How research runs

```
POST /api/research  → job created and queued (202)
worker              → fetch quote + candles + official-first evidence, calculate indicators/patterns
                    → chart, technical, news, sentiment in parallel
                    → risk (sees the specialists) → deterministic gate
                    → coordinator (sees the gate) → report
GET /api/jobs/:id   → poll status, agent runs, gate, report, evidence
```

Multi-agent work never runs inside a web request (decision O1). Without
`QSTASH_TOKEN`/`WORKER_URL` the queue is process-local: run `npm run worker` in the
same workspace. Production needs QStash and a worker deployment.

## API

Same-origin `/api/*`, rate limited, no `/v1` prefix. Full reference:
[`docs/architecture/api.md`](docs/architecture/api.md).

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health`, `/api/provider-status` | Configuration, capabilities and verification levels |
| `GET /api/instruments`, `/api/universe`, `/api/search` | Catalog, curated list, provider search |
| `GET /api/market`, `/api/top-stocks` | Verified quotes (single and batch) |
| `GET /api/history`, `/api/indicators`, `/api/analysis` | Candles, deterministic indicators, chart structure |
| `GET /api/news` | News + official filing evidence (sanitized, deduplicated) |
| `GET /api/coverage` | Evidence coverage per capability, with limitations (also shown in the UI) |
| `GET /api/nav` | Official AMFI end-of-day NAV (`isin` or `schemeCode`) |
| `GET /api/official-data` | Optional data.gov.in open datasets (requires `DATA_GOV_IN_API_KEY`) |
| `POST /api/report` | Single-shot AI commentary on a verified quote |
| `POST /api/research`, `GET /api/jobs`, `GET /api/jobs/[jobId]` | Durable research jobs |
| `POST /api/worker` | Queue delivery entry point (`WORKER_SECRET`) |

## Configuration

Everything is server-side; the browser never holds a provider key.

| Group | Variables |
| --- | --- |
| Market data | `FMP_API_KEY`, `TWELVE_DATA_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `PRIMARY_MARKET_PROVIDER`, `SECONDARY_MARKET_PROVIDER` |
| AI | `GROQ_API_KEY`, `GROQ_MODEL`, `AI_MODEL_*`, `AI_TIMEOUT_MS`, `AI_RETRIES`, `AI_BACKOFF_MS`, `AI_TOOL_CALLING`, `AI_TOOL_AGENTS` |
| Official evidence | `NEWS_RSS_ENABLED`, `NEWS_RSS_FEEDS`, `BSE_ANNOUNCEMENTS_RSS`, `NSE_ANNOUNCEMENTS_RSS`, `SEC_USER_AGENT`, `DATA_GOV_IN_API_KEY` |
| News | `NEWS_API_KEY`, `GNEWS_API_KEY`, `NEWS_PROVIDER_ORDER`, `NEWS_RSS_FEEDS` |
| Filings (unverified) | `NSE_FILINGS_COOKIE`, `BSE_FILINGS_ENABLED` |
| Queue | `QSTASH_TOKEN`, `WORKER_URL`, `WORKER_SECRET`, `WORKER_POLL_MS` |
| Storage | `DATABASE_URL`, `DATABASE_SSL`, `DATABASE_POOL_MAX`, `OBJECT_STORE_ROOT`, `S3_*` |
| Rate limits | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |

See [`.env.example`](.env.example) for the annotated list.

## Postgres and object storage

```bash
export DATABASE_URL=postgres://user:pass@host:5432/marketlens
node -e "import('./server/storage/index.js').then(m => m.getStorage())"   # applies migrations
```

Without `DATABASE_URL` jobs live in process memory (development only). Reports are
insert-only: a correction is a new report row plus a `report_revisions` entry, and
stored evidence keeps the excerpt and retrieval time observed when the analysis ran.

## Documentation

- [`docs/architecture/README.md`](docs/architecture/README.md) — system overview and layout
- [`docs/architecture/api.md`](docs/architecture/api.md) — endpoints and error shapes
- [`docs/architecture/agents.md`](docs/architecture/agents.md) — agent contracts
- [`docs/architecture/roadmap.md`](docs/architecture/roadmap.md) — milestone status, honestly marked
- [`docs/architecture/decisions.md`](docs/architecture/decisions.md) — decision log
- [`docs/architecture/security.md`](docs/architecture/security.md) — secrets, untrusted input, model-output guards, tool allow-list
- [`docs/architecture/evidence-sources.md`](docs/architecture/evidence-sources.md) — permitted vs prohibited sources, adapters, caching
- [`docs/architecture/environment-audit.md`](docs/architecture/environment-audit.md) — env inventory and retirement proposals (nothing deleted)
- [`docs/architecture/observability.md`](docs/architecture/observability.md) — what is and is not instrumented
- [`docs/architecture/testing.md`](docs/architecture/testing.md) — suites and coverage gaps
- [`docs/architecture/execution-deployment.md`](docs/architecture/execution-deployment.md) — worker deployment and cost model

## Verification status

Tested locally: contracts, market data (stubbed), indicators, patterns, news
sanitization/dedupe, official-feed configuration, SEC EDGAR and AMFI adapters
(fixtures), data.gov.in adapter, coverage states, Groq tool-calling loop (stub
provider), all six agents (stubbed provider), gate, jobs, queue adapters, storage
SQL mapping, object storage, endpoints, production build.

Not verified against live services: provider calls, Groq calls, official feed
reachability, SEC EDGAR and AMFI responses, QStash delivery, PostgreSQL migrations
on a real instance, S3 uploads, NSE/BSE announcement access (no NSE scraper exists).
Those are marked *awaiting configuration* or *unverified* wherever they appear.

Research and educational use only. Not investment advice.
