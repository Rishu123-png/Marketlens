# Milestone 0 — Repository audit

Audited: 2026-11-12, branch `arena/32b040eb-marketlens` at `811387a`.
Scope: every tracked file (39 files, 5,017 lines excluding the lockfile), all API
routes, providers, AI integration, tests, environment and deployment config.

This is a factual inventory, not a plan. The plan is in
[`roadmap.md`](./roadmap.md); the agreed target is in
[`market-lens-target-architecture.md`](./market-lens-target-architecture.md).

## Status vocabulary

| Status | Meaning |
| --- | --- |
| **Implemented** | Code exists, is exercised by tests, and works |
| **Partial** | Works for a subset of the intended scope |
| **Planned** | Designed, not built |
| **Awaiting configuration** | Code complete but inert without a provider key or infra |
| **Blocked** | Cannot proceed without a decision, credential or licensed data source |

## 1. Existing repository architecture

| Layer | Implementation | Size |
| --- | --- | --- |
| Frontend | React 19 + Vite 8 SPA, one component | `src/main.jsx` 296 lines, `src/styles.css` 230 |
| API | Vercel-style serverless handlers, one file per route | `api/*.js`, 10 routes |
| Domain | Provider adapters, quote gateway, indicator engine, instrument catalog | `server/` 671 lines, `shared/` 318 |
| Local runtime | `node:http` adapter that mounts the same handlers, + Vite proxy | `scripts/api-server.js` 124 |
| Data | No database, no object storage; in-process caches only | — |
| Tests | `node --test`, 72 tests in 9 files | `test/`, `tests/` 1,022 |
| CI | GitHub Actions: audit → syntax check → test → build | `.github/workflows/ci.yml` |
| Docs | Architecture, decisions, data flow, agent contracts, this audit | `docs/` |

Request path: browser → Vite (`:5173`) → proxy `/api/*` → local adapter
(`127.0.0.1:8787`) → `api/<route>.js` → `server/` or `shared/`. In production,
Vercel replaces the adapter; handler signatures are identical by design.

**Coupling hazard:** the local adapter has a hardcoded `routes` set. A new
`api/*.js` file is 404 locally until that set is updated (hit during M2).

## 2. Existing frontend functionality

| Capability | Status | Notes |
| --- | --- | --- |
| Instrument table (20 curated NSE equities) | Implemented | `src/main.jsx` |
| Local filter by symbol/name/sector | Implemented | client-side |
| Provider search for extra symbols | Implemented | `GET /api/search`, results merged into table |
| Watchlist | Implemented | `localStorage` key `marketlens-watchlist`, device-only |
| Quote detail modal | Implemented | fetches `/api/market`, renders provider metrics |
| AI analysis button in modal | Implemented | `POST /api/report`, renders headline/summary/risks |
| Auto-refresh of batch quotes | Implemented | every 5 minutes |
| Gainers / losers tabs | Implemented | derived from batch quotes |
| "Verified data only" presentation | Implemented | missing prices render as `—` |
| Routing / multiple pages | **Planned** | no router installed |
| Charts (candles, overlays) | **Planned** | no charting dependency installed |
| Shared state management | **Planned** | only component state + `localStorage` |
| Agent monitor, reports, settings | **Planned** | no screens exist |
| Accessibility | Partial | labels present; modal has no focus trap or Escape handling |

## 3. Existing backend / API functionality

| Route | Behaviour | Status |
| --- | --- | --- |
| `GET /api/market?symbol=&exchange=` | One provider-verified quote via gateway | Implemented |
| `GET /api/top-stocks` | 20 curated NSE symbols, concurrency 4, ranked by score, 5 min cache | Implemented |
| `GET /api/instruments` | Catalog listing, filters, ranked local search, id lookup, paging | Implemented |
| `GET /api/universe` | Legacy curated list (20), IDs included | Implemented |
| `GET /api/search?q=` | FMP/Twelve/Alpha symbol search, Indian-only filter | Implemented |
| `GET /api/history?symbol=&interval=` | Candles from Twelve/Alpha, interval whitelist | Implemented |
| `POST /api/report` | Server-fetched quote → Groq → JSON report | Implemented |
| `GET /api/health` | Which provider keys exist | Implemented |
| `GET /api/provider-status` | Overlaps `/api/health` | Duplicate |
| `GET /api/finnhub` | Finnhub quote adapter, not part of the gateway, unused by UI | Orphan |

Request validation: symbol regex (`^\^?[A-Z0-9._:&-]{1,40}$`), query length caps,
asset-type enum, numeric limit clamps, 256 KB JSON body cap in the local adapter.
Error handling: consistent `{ error, details? }`; 500s are sanitised.

## 4. Existing market-data integrations

| Provider | Quotes | Search | Candles | Key |
| --- | --- | --- | --- | --- |
| FMP | Implemented (`.NS`/`.BO` suffix + bare fallback) | Implemented | — | `FMP_API_KEY` |
| Twelve Data | Implemented (derived `NSE:SYMBOL`) | Implemented | Implemented | `TWELVE_DATA_API_KEY` |
| Alpha Vantage | Implemented (bare + `.BSE` fallback) | Implemented | Implemented (daily/weekly) | `ALPHA_VANTAGE_API_KEY` |
| Finnhub | Orphan route | — | — | `FINNHUB_API_KEY` |
| News API | — | — | — | `NEWS_API_KEY` declared, **never used** |

Quote path: `server/market-data/gateway.js` — order from
`PRIMARY_MARKET_PROVIDER` (default `fmp`), automatic fallback, per-provider errors
collected, 60 s cache (500-entry cap), concurrency helper for batches.
Normalization: `normalize.js` produces one shape with provider timestamp,
retrieval timestamp and `freshness: "verified"`.

Instrument identity: `shared/instruments/catalog.js`, 36 instruments (20 IN
equities, 8 US equities, 5 indices, 3 ETFs) with stable IDs and per-provider
mapping. Index tickers require explicit mapping; equities/ETFs derive by
exchange convention. Unmapped combinations are declared unsupported, never guessed.

## 5. Existing Groq integration

Single call site: `api/report.js`.

| Aspect | Current value |
| --- | --- |
| Endpoint | `https://api.groq.com/openai/v1/chat/completions` |
| Model | `process.env.GROQ_MODEL`, default `llama-3.3-70b-versatile` |
| Temperature | 0.1 |
| Response format | `json_object` |
| Timeout | 20 s via `AbortController` |
| Prompt | One ~70-line instruction block with 7 data rules and a fixed JSON key list |
| Input | Server-fetched `verifiedMetrics` only; browser-supplied prices ignored |
| Output validation | `JSON.parse` only — shape is **not** validated |
| Rate limit | 5 requests / 10 min / IP (Upstash if configured, else per-instance memory) |
| Retries | None |
| Token/cost tracking | None |
| Provider abstraction | None — Groq is hardcoded |

## 6. Existing report-generation implementation

`POST /api/report` returns `{ report, analysisSource, verifiedMetrics }`.
No report is persisted; there is no report ID, no evidence IDs, no history, no
comparison, no depth selection, no per-agent output. The "agents" concept does not
yet exist in code — it is a single prompt in a single request.

## 7. Existing historical-data support

`GET /api/history` returns normalized OHLCV arrays (oldest→newest) from Twelve
Data (any supported interval) or Alpha Vantage (daily/weekly only). No storage, no
adjustment metadata, no corporate-action handling, no intraday caching, and no
consumer in the frontend yet. The indicator engine
(`server/indicators/`, 349 lines, 24 tests) consumes candle arrays but is not
exposed over HTTP.

## 8. Existing security practices

| Control | Status |
| --- | --- |
| Secrets server-side only; no `VITE_*` secrets | Implemented |
| `.env*` gitignored; only `.env.example` committed | Implemented |
| Input validation on symbol, query, asset type, paging | Implemented |
| Per-client rate limits: report 5/10 min, market 120/min, batch 30/min, search 30/min, instruments 120/min | Implemented |
| Shared limiter store (Upstash) with memory fallback | Awaiting configuration |
| Sanitised 500 responses | Implemented |
| Authentication / authorisation | **Missing** |
| Security headers (CSP, HSTS, frame options) | **Missing** |
| Audit logging / request IDs | **Missing** |
| Untrusted-content policy for news text | Documented only (no news pipeline yet) |
| Dependency audit in CI (`npm audit --audit-level=high`) | Implemented, 0 known issues |

## 9. Existing database / storage situation

**None.** No PostgreSQL, no ORM/migrations, no object storage, no queue. All state
is per-process:

| State | Location | Lifetime |
| --- | --- | --- |
| Quote cache | `gateway.js` Map | 60 s, per instance |
| Batch quote cache | `api/top-stocks.js` | 5 min, per instance |
| Rate-limit counters | `lib/server/rateLimit.js` Set/Map | window, per instance |
| Watchlist | browser `localStorage` | per device |

Research jobs, agent runs, evidence, reports and comparisons have nowhere to live.

## 10. Existing tests and deployment

159 tests, all passing. M0 baseline was 72; M1 added 87 (schemas 10, job lifecycle
13, publication gate 32, AI abstraction 20, boundaries 7, report endpoint +3,
gateway contract enforcement +2).

CI (`ubuntu-latest`, Node 22): `npm ci` → `npm audit --audit-level=high` →
`npm run check` → `npm test` → `npm run build`. No lint, no type checking, no
formatting — there is no linter or TypeScript configured.

Deployment: Vercel, Vite preset, five functions with explicit `maxDuration`
(10–60 s) and one redundant rewrite (`/api/market`). The live URL in the brief
(<https://marketlens-pi.vercel.app/>) **could not be verified from this sandbox** —
outbound access is restricted to GitHub/npm/PyPI. Deployment status is therefore
"awaiting verification" rather than assumed healthy.

## 11. Features that can be preserved

1. The verified-data invariant and its presentation (`—`, no estimates, no demo rows).
2. Server-side quote sourcing for AI input (`/api/report` ignores browser metrics).
3. Provider adapter layer, gateway, normalization and instrument catalog.
4. Deterministic indicator engine and its reference tests.
5. Rate limiter with shared-store failover.
6. Local dev adapter + Vite proxy workflow (identical handler signatures to Vercel).
7. CI pipeline and syntax guard.
8. Architecture docs, decision log and agent contracts.
9. The existing dark terminal styling as the basis for the redesign.

## 12. Features requiring modification

| Area | Change needed |
| --- | --- |
| `src/main.jsx` | Split into router + pages + components; keep the visual language |
| `api/report.js` | Replace single prompt with orchestrator call; keep verified-quote rule |
| `api/search.js` | Route through provider adapters; add filings/company sources later |
| `api/history.js` | Reuse provider adapters; add candle caching/persistence and adjustment flags |
| `api/provider-status.js` | Merge into `/api/health` |
| `lib/stock-universe.js` | Keep as compatibility shim; new code uses the catalog |
| `lib/server/rateLimit.js` | Move under `server/security/` when endpoints are reorganised |
| `scripts/api-server.js` | Discover routes from the filesystem instead of a hardcoded set |
| `vercel.json` | Add per-function limits for new routes; drop the redundant rewrite |

## 13. Missing components

Orchestrator and durable jobs · agent modules and prompts · AI provider
abstraction (provider/model/temperature/timeout/retry per agent) · runtime schema
validation · news/filings/commentary ingestion · evidence store · sentiment
pipeline · pattern detection · PostgreSQL + migrations · object storage ·
analytics · observability · authentication · research depths · publication gate ·
report persistence and comparison · chart rendering · server-side watchlists ·
security headers.

## 14. Technical risks

| # | Risk | Impact | Mitigation |
| --- | --- | --- | --- |
| 1 | Six agents in one serverless request will exceed 60 s | Research jobs fail mid-flight | Durable job record + background execution (queue/cron), polling API (roadmap M5) |
| 2 | Per-instance caches and per-instance rate limits | Inconsistent limits and costs at scale | Shared Upstash store; cache moves to Postgres/Redis in M8 |
| 3 | Provider quota exhaustion / cost | 429s, silent coverage gaps | Caching, batch concurrency caps, per-client limits, usage metrics |
| 4 | FMP legacy `/api/v3` quote path may be deprecated for new accounts | Primary provider silently returns nothing | Verify against current FMP docs; adapt endpoint in the adapter only (single file) |
| 5 | Licensing: redistribution of prices/news is not implied by API access | Legal exposure | Confirm per-provider terms before any persistent news/price storage or export |
| 6 | Prompt injection through news/filing text | Manipulated AI output | Evidence delimited from instructions; no retrieved text in system prompt; schema-validated outputs |
| 7 | No authentication | Any report/job endpoint is public | Auth before research history ships (M8) |
| 8 | Agent output is parsed but not validated | Malformed/partial analysis reaches users | JSON schema validation + rejection, gate on mandatory agents |
| 9 | Groq limits; six keys exist | Temptation to rotate keys to bypass limits | Explicitly rejected: one credential, backoff, caching, budget caps |
| 10 | Hand-maintained adapter route list | New routes 404 in local dev | Filesystem route discovery |
| 11 | Data delay/coverage differences across providers | "Verified" could still be stale | Freshness rules + cross-provider tolerance check in the risk stage |
| 12 | Deployment state unverified | Unknown production drift | Verify the deployed build and env vars from Vercel before M7 |

## 15. Recommended implementation order

Matches [`roadmap.md`](./roadmap.md): finish the contract layer (schemas, job
lifecycle, gate rules) → candles + indicator HTTP surface → news/evidence
ingestion → agents + orchestrator → reports + gate → frontend redesign → storage
and analytics → global expansion → production validation.

Rationale: agents are the least valuable layer if the evidence beneath them is
unvalidated, and the most expensive to rebuild if the contracts change later.
