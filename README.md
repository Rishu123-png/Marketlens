# MarketLens

A React/Vite Indian-equities market terminal backed by serverless market-data and report APIs. It opens directly to a curated list of 20 popular NSE stocks; search filters that list instantly, with provider search available for other symbols. Live prices appear only when returned by a configured market-data provider. Market data and AI output are informational only, not investment advice.

## Local development

```bash
npm ci
cp .env.example .env.local
# Add provider keys to .env.local as needed
npm run dev
```

`npm run dev` starts both the Vite frontend and a small local adapter for the `api/` handlers. Vite proxies browser `/api/*` requests to that adapter. The adapter binds only to `127.0.0.1`; the frontend binds to `0.0.0.0` for the Arena preview. Configure provider keys in `.env.local` (never in `VITE_*` variables or committed files). The app can load without keys, but live market data and AI reports require working provider credentials and quotas.

Useful commands:

```bash
npm run check  # parse-only syntax guard over api/, server/, lib/, scripts/, tests/
npm test       # Node's built-in test runner
npm run build  # production frontend build
```

## API

All routes are same-origin under `/api` and are per-client rate limited.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/instruments` | Instrument catalog. Filters: `country`, `exchange`, `assetType` (`equity`/`index`/`etf`), `sector`; search with `q`; lookup with `id`; paging with `limit`/`offset` |
| `GET /api/market?symbol=&exchange=` | One verified quote |
| `GET /api/top-stocks` | Ranked popular NSE quotes (5 min cache) |
| `GET /api/search?q=` | Provider-backed symbol search for instruments outside the catalog |
| `GET /api/history?symbol=&interval=` | Historical candles (Twelve Data / Alpha Vantage) |
| `POST /api/report` | AI report over server-fetched, verified metrics only |
| `GET /api/universe` | Legacy curated list of 20 popular NSE stocks |
| `GET /api/health` | Provider key configuration status |

Instrument identity comes from `shared/instruments/catalog.js`; quotes always go
through `server/market-data/gateway.js`, which owns provider order, fallback,
caching and the rule that an unverified price is never returned.

## Architecture

Market Lens is being extended from a quote dashboard into a multi-agent research
terminal. Start at [`docs/architecture/`](docs/architecture/README.md):
the [audit](docs/architecture/audit.md) of what exists, the
[target architecture](docs/architecture/market-lens-target-architecture.md), and
the [roadmap](docs/architecture/roadmap.md) with milestone status.

Deterministic calculations live in `server/`, never in prompts. The indicator
engine (`server/indicators/`) is the first delivered module; the Technical agent
interprets its output but never computes it.

## Deploying to Vercel

Import the repository into Vercel and use the detected Vite settings. Configure the variables from `.env.example` in the Vercel project settings. At minimum, configure a supported market-data key for live quotes and `GROQ_API_KEY` for AI analysis. Do not commit `.env.local` or provider keys.

The report endpoint accepts a stock symbol, then fetches its quote itself through the server-side verified market gateway. Prices, provider names, timestamps, and other quote metrics supplied by a browser are ignored. AI reports are generated only when the server gets a usable provider quote.

## Operational notes

- Market quotes are cached in-process for 60 seconds. Vercel instances have independent caches.
- AI analysis is limited to five requests per client IP per ten minutes. The limiter uses shared Upstash Redis when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set. Without them, it falls back to an in-memory best-effort limit per server instance. Configure Upstash in Vercel before relying on strict production cost control; if Redis is temporarily unavailable, the endpoint falls back to the local limiter.
- Provider coverage, freshness, quotas, and plan entitlements vary. A configured key does not guarantee that a quote will be available.
- No trading or order-placement functionality is provided. Verify financial information with your provider before making decisions.
