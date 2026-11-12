# Environment variable audit

Status: **nothing has been deleted or modified in Vercel.** This document records
what the code reads, what it is for, and which variables are candidates for
retirement if the owner decides to remove them.

> **Inspection limitation.** The Vercel project's actual environment values could
> not be read from this environment: there is no `vercel` CLI, no `.vercel/`
> project link, and the GitHub token lacks access to repository secrets
> (`gh secret list` → HTTP 403). The inventory below is derived from a code
> search, plus `.env.example`. To reconcile it with production, run
> `vercel env ls` (names only) and compare. Do not remove anything until that
> comparison is done.

## Complete variable inventory (as read by code)

`server/`, `api/`, `shared/`, `lib/`, `scripts/` were searched for
`process.env.*` and for injected `env.*` access.

| Variable | Read by | Purpose | Classification |
| --- | --- | --- | --- |
| `GROQ_API_KEY` | `server/ai/*`, `api/research`, `api/report` | Only AI provider; all six agents and report reasoning | **Core** (research needs it) |
| `GROQ_MODEL` | `server/ai/config.js` | Default model | **Core** |
| `AI_MODEL_<AGENT>` | `server/ai/config.js` | Per-agent model override | Optional tuning |
| `AI_TIMEOUT_MS`, `AI_RETRIES`, `AI_BACKOFF_MS` | `server/ai/config.js` | Request timeout/retry policy | Optional tuning |
| `AI_TOOL_CALLING` | `server/ai/toolPolicy.js` | `off` disables Groq tool calling | Optional (new) |
| `AI_TOOL_AGENTS` | `server/ai/toolPolicy.js` | Comma list of tool-enabled agents | Optional (new) |
| `FMP_API_KEY` | `server/market-data/providers/fmp.js` | Quotes/indices | Conditional |
| `TWELVE_DATA_API_KEY` | `server/market-data/providers/twelve.js` | Candles | Conditional |
| `ALPHA_VANTAGE_API_KEY` | `server/market-data/providers/alpha.js` | Candles | Conditional |
| `PRIMARY_MARKET_PROVIDER`, `SECONDARY_MARKET_PROVIDER` | `server/market-data/gateway.js` | Provider order / cross-check | Conditional |
| `FINNHUB_API_KEY` | `api/finnhub.js`, `api/health.js` | Legacy single-quote route | **Retirement candidate** (see below) |
| `NEWS_API_KEY` | `server/news/providers/newsapi.js` | Optional news API | Optional fallback |
| `GNEWS_API_KEY` | `server/news/providers/gnews.js` | Optional news API | Optional fallback |
| `NEWS_PROVIDER_ORDER` | `server/news/providers/index.js` | Provider precedence | Optional |
| `NEWS_RSS_FEEDS` | `server/news/feeds.js` | Operator-supplied feeds (`Publisher\|url`) | Optional |
| `NEWS_RSS_ENABLED` | `server/news/feeds.js` | `off` disables all feed polling | Optional (new) |
| `BSE_ANNOUNCEMENTS_RSS` | `server/news/feeds.js` | Official BSE RSS URL | Optional (new) |
| `NSE_ANNOUNCEMENTS_RSS` | `server/news/feeds.js` | NSE feed; only with written permission | Optional, terms-gated (new) |
| `SEC_USER_AGENT` | `server/evidence/secEdgar.js` | SEC-required descriptive UA + contact email | Optional; required for US filings (new) |
| `DATA_GOV_IN_API_KEY` | `server/evidence/dataGovIn.js` | OGD datasets | Optional (new) |
| `NSE_FILINGS_COOKIE` | `server/news/filings/index.js` | NSE announcements via session cookie | **Retirement candidate** (terms) |
| `BSE_FILINGS_ENABLED` | `server/news/filings/index.js` | Placeholder for a disabled BSE adapter | **Retirement candidate** (unused) |
| `WORKER_URL`, `WORKER_SECRET`, `WORKER_POLL_MS` | `server/jobs/*`, `scripts/worker.js` | Worker invocation and auth | Required for durable execution |
| `QSTASH_TOKEN` | `server/jobs/queue.js` | QStash publishing | Conditional |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | `lib/server/rateLimit.js` | Shared rate limiting | Optional |
| `DATABASE_URL`, `DATABASE_POOL_MAX`, `DATABASE_SSL` | `server/storage/postgres.js` | Durable storage | Required for durable production |
| `OBJECT_STORE_ROOT` | `server/storage/objectStore.js` | Local report artefacts | Optional |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | `server/storage/s3.js` | Object storage | Conditional |
| `API_PORT` | `scripts/api-server.js` | Local API port | Local only |

No `VITE_*` variable is read by `src/` or `index.html`; the frontend holds no
provider secrets.

## Retirement candidates (proposals only — nothing executed)

| Variable | Why it is a candidate | Precondition before removal |
| --- | --- | --- |
| `NSE_FILINGS_COOKIE` | NSE's terms of use prohibit systematic automated collection without written consent; the cookie-based adapter is legally fragile and off by default. | Confirm no licensed NSE integration depends on it; keep the code path but delete the credential. |
| `FINNHUB_API_KEY` | `api/finnhub.js` is a legacy single-quote route outside the M1–M10 pipeline and is not used by research. | Confirm no external caller uses `/api/finnhub`; retire the route first. |
| `BSE_FILINGS_ENABLED` | The BSE filings adapter intentionally throws; no working code path consumes this flag. | None beyond owner approval; official BSE RSS (`BSE_ANNOUNCEMENTS_RSS`) is the supported route. |

Do **not** remove `FMP_API_KEY`, `TWELVE_DATA_API_KEY` or `ALPHA_VANTAGE_API_KEY`
without first confirming that at least one candle provider remains: with none,
`/api/history`, `/api/indicators` and `/api/analysis` correctly return 503 and
research cannot compute indicators.

## `.env.example` changes made

- Added the new variables (`SEC_USER_AGENT`, `DATA_GOV_IN_API_KEY`,
  `BSE_ANNOUNCEMENTS_RSS`, `NSE_ANNOUNCEMENTS_RSS`, `NEWS_RSS_ENABLED`,
  `AI_TOOL_CALLING`, `AI_TOOL_AGENTS`).
- Removed the duplicated `NEWS_API_KEY` entry from the example file only (the
  variable itself is unchanged).
- Marked `NSE_FILINGS_COOKIE`, `BSE_FILINGS_ENABLED` and `FINNHUB_API_KEY` as
  candidates in comments; values are untouched.
