# MarketLens

A React/Vite stock-analysis interface backed by serverless market-data and report APIs. Market data and AI output are informational only, not investment advice.

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
npm test       # Node's built-in test runner
npm run build  # production frontend build
```

## Deploying to Vercel

Import the repository into Vercel and use the detected Vite settings. Configure the variables from `.env.example` in the Vercel project settings. At minimum, configure a supported market-data key for live quotes and `GROQ_API_KEY` for AI analysis. Do not commit `.env.local` or provider keys.

The report endpoint accepts a stock symbol, then fetches its quote itself through the server-side verified market gateway. Prices, provider names, timestamps, and other quote metrics supplied by a browser are ignored. AI reports are generated only when the server gets a usable provider quote.

## Operational notes

- Market quotes are cached in-process for 60 seconds. Vercel instances have independent caches.
- AI analysis is limited to five requests per client IP per ten minutes. The limiter uses shared Upstash Redis when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set. Without them, it falls back to an in-memory best-effort limit per server instance. Configure Upstash in Vercel before relying on strict production cost control; if Redis is temporarily unavailable, the endpoint falls back to the local limiter.
- Provider coverage, freshness, quotas, and plan entitlements vary. A configured key does not guarantee that a quote will be available.
- No trading or order-placement functionality is provided. Verify financial information with your provider before making decisions.
