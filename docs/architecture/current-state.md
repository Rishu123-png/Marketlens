# Repository audit — current state vs. target

Audit date: 2026-11-12. Commit `5adc24e` on `arena/32b040eb-marketlens`.

## What exists

| Area | Status | Files |
| --- | --- | --- |
| React terminal UI | Working, single file, 296 lines | `src/main.jsx`, `src/styles.css` |
| Market quote gateway | Working, 3 providers, 60 s cache | `api/market.js` |
| Batch quote / movers | Working, 20 symbols | `api/top-stocks.js` |
| Provider search | Working | `api/search.js` |
| AI report (single prompt) | Working, rate limited, verified metrics only | `api/report.js` |
| Historical candles | Fixed in this branch (was unparseable) | `api/history.js` |
| Health / provider status | Working, overlapping | `api/health.js`, `api/provider-status.js` |
| Rate limiting | Report endpoint only; Upstash or in-memory | `lib/server/rateLimit.js` |
| Local dev adapter | Working (Vite + node:http shim) | `scripts/dev.js`, `scripts/api-server.js` |
| Tests | 12 passing (`node --test`) | `test/` |
| CI | npm audit + test + build | `.github/workflows/ci.yml` |

Verified: `npm ci`, `npm test` 12/12, `npm run build`, `npm audit` clean, all
`/api/*` routes probed with and without provider keys.

## Gap analysis

| Blueprint capability | Today | Gap |
| --- | --- | --- |
| Multi-market instruments | Hard-coded 20 NSE symbols in `lib/stock-universe.js` | No instrument registry, no global symbols, no internal IDs |
| Provider adapters | Per-file `fetchFmp`/`fetchTwelve`/`fetchAlpha`, duplicated in `market.js` and `top-stocks.js` | Extract one adapter layer; normalize once |
| Normalized quote schema | Ad-hoc objects; `market.js` and `top-stocks.js` differ | Define `shared/schemas` |
| Historical candles | Renewed, Twelve/Alpha only, no storage | No persistence, no intraday for Alpha |
| Indicator engine | None (only a toy `rsi` in unused `src/lib/analysis.js`) | **Delivered in M1** |
| News ingestion | `NEWS_API_KEY` read by health only, never used | No provider, no dedupe, no freshness model |
| Six agents | One monolithic prompt in `api/report.js` | No agent modules, no orchestration, no per-agent schemas |
| Orchestration / jobs | None | No job model, no statuses, no retries, no persistence |
| Evidence linking | Report carries `verifiedMetrics` only | No `evidence_items` |
| Reports history | None | No storage or comparison |
| Database | None | PostgreSQL not wired |
| Frontend pages | One dashboard + modal | Router, 8 pages, chart rendering (no chart lib installed) |
| Rate limiting | Report only | Quotes/search/batch routes unprotected |
| Observability | None | No timing, no agent failure metrics |

## Files that are dead or duplicated

| File | Issue | Proposed action |
| --- | --- | --- |
| `src/lib/marketClient.js` | Never imported | Delete, or keep as the API client after the `services/` refactor |
| `src/lib/analysis.js` | Never imported; its `rsi` is a naive average-based approximation, not Wilder | Delete; superseded by `server/indicators/` |
| `api/finnhub.js` | Never called by the UI; not the gateway used by `/api/market` | Fold into the provider adapter layer |
| `api/provider-status.js` | Duplicates `api/health.js` reporting | Keep one endpoint |
| `api/history.js` | No frontend caller (Chart Lab will use it) | Keep; becomes the candle source for Chart Lab |

## Risks to fix before agents land

1. **Cost exposure.** `/api/market`, `/api/top-stocks`, `/api/search` have no
   rate limit; `top-stocks` fans out 20 × up to 3 provider calls per request.
2. **Batch timeout.** `top-stocks` uses concurrency 2 with a 250 ms sleep and
   9 s provider timeouts, which can exceed the 60 s `maxDuration`.
3. **Per-instance caches.** `Map` caches reset per Vercel instance and are not
   shared; reports cannot yet depend on them for reproducibility.
4. **No schema validation.** Agent and provider outputs are trusted shapes.
   Needs `shared/schemas` + runtime validation before orchestration.
5. **No lint.** CI runs audit/test/build only; that is how the `api/history.js`
   syntax error shipped. Add `node --check` over `api/` and `server/`.

## Migration order

1. **M1 (this turn)** — architecture docs; indicator engine + reference tests.
2. **M1.5** — `shared/schemas` (instrument, quote, candle, evidence), then
   extract the provider adapters out of `api/market.js` / `api/top-stocks.js`
   into `server/market-data/` so both endpoints share one implementation.
3. **M2** — instrument registry with internal IDs (`IN-EQ-RELIANCE`), India +
   global seed data, `/api/instruments*`.
4. **M3/M4** — candle persistence, indicator snapshot endpoint.
5. **M5–M7** — agents, orchestrator, evidence-linked reports.
6. **M8–M10** — router + pages, Chart Lab, Agent Monitor, hardening.

Nothing is moved or deleted before its replacement is covered by tests.
