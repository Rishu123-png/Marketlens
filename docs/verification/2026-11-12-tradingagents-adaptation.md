# Verification — TradingAgents adaptation

**Date:** 2026-11-12  
**Branch:** `arena/70c91a09-marketlens`  
**Base:** `main` @ `cd760be`

## 1. Local checks

| Check | Command | Result |
| --- | --- | --- |
| Unit/integration tests | `npm test` | **368 passed, 0 failed** |
| Syntax/type-adjacent check | `npm run check` | **165 files parse cleanly** |
| Production build | `npm run build` | **success** (`vite v8.3.6`, 41 modules) |
| Security audit | `npm audit --omit=dev` | **0 vulnerabilities** |
| Full audit | `npm audit` | **0 vulnerabilities** |

The build reports the existing >500 kB chunk warning. No new build failure was introduced.

## 2. Local API smoke test

Started `npm run dev` and read the real handlers:

| Endpoint | Observation |
| --- | --- |
| `/api/diagnostics` | `market.registry.version = "2.0.0"`; FMP/Twelve/Alpha `active`; Yahoo `rejected-terms`; matrix 163 instruments |
| `/api/diagnostics` | NSE `1day`: declared FMP/Twelve/Alpha, configured `[]`, verified `0`, status `declared-not-configured` |
| `/api/diagnostics` | `providerSelection["IN-EQ-TCS"].quote.selected = null` with no keys configured |
| `/api/provider-status` | `providerRegistry.version = "2.0.0"`; TCS NSE selection `null` with no keys configured |

This verifies wiring, not market coverage.

## 3. Mocked vs live verification

| Area | Mocked/unit verification | Live verification |
| --- | --- | --- |
| Symbol resolution (TCS NSE/BSE, HINDUNILVR, NIFTY 50, BANKNIFTY, derivatives) | ✅ `catalog.test.js`, `provider-registry.test.js` | ⚠️ Identity only; no live derivative quotes |
| Provider registry/entitlement/interval selection | ✅ `provider-registry.test.js` | ⚠️ Declarations from provider docs; runtime still needs a configured account |
| Quota exhaustion, circuits, cache, dedupe | ✅ existing `market-policy.test.js`, `gateway.test.js`, `candles.test.js` | ⚠️ Prior production probe observed FMP 403/premium, Twelve 429/1067-of-800, Alpha 429 |
| Tool calling (all seven tools + aliases) | ✅ `tools.test.js` | ❌ Live Groq tool-call not re-run in this branch |
| Parallel agents, gate blocking, report persistence | ✅ `orchestrator.test.js`, `pipeline.test.js`, `jobs.test.js` | ❌ Not redeployed in this branch |
| Reproducibility/replay | ✅ `reproducibility.test.js`, `replay.test.js`, PG SQL assertion | ❌ Not redeployed in this branch |
| Migration `004` | ✅ SQL shape asserted through `saveResult` params | ❌ No live PostgreSQL in this environment |
| Yahoo/yfinance | ✅ registry marks it rejected and unregistered | ✅ Terms reviewed; **no request made** because automated collection is prohibited without permission |
| NSE lot sizes | ✅ identity tests | ✅ Read directly from NSE circular `NSE/FAOP/70616` (2025-10-03) |

## 4. External sources verified

| Source | URL | Finding used |
| --- | --- | --- |
| NSE circular | https://nsearchives.nseindia.com/content/circulars/FAOP70616.pdf | Nifty 50 lot 65, Bank Nifty lot 30, effective from the 2025-12-30 expiries |
| Yahoo Terms of Service | https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html | §2.4.9 prohibits automated collection without express prior permission |
| yfinance README | https://github.com/ranaroussi/yfinance | Not affiliated with Yahoo; Yahoo Finance API intended for personal use only |
| Alpha Vantage docs | https://www.alphavantage.co/documentation/ | India uses `.BSE`; intraday/adjusted daily are Premium |
| Twelve Data pricing | https://twelvedata.com/pricing | Basic $0 is 8 credits/min, 800/day, US only |
| Twelve Data exchanges | https://twelvedata.com/exchanges?level=grow | XNSE/XBOM EOD on Grow; display needs licensing |
| FMP pricing/docs | https://site.financialmodelingprep.com/developer/docs/pricing | Global/intraday entitlement is plan-gated; display needs separate licensing |

No purchase, upgrade, trial, key rotation or plan change was performed.

## 5. Known live-coverage result

The deployed production instance was probed earlier on 2026-11-12 (before this branch existed):

- FMP: HTTP 200 text `Premium Query Parameter…` / `Restricted Endpoint…`; no India/intraday entitlement.
- Twelve Data: `429`, `1067 API credits were used, with the current limit being 800`; circuit `quota-exhausted`.
- Alpha Vantage: `429`, `1 request per second`; circuit `rate-limited`.
- Coverage: `catalogued 160`, `verifiedLatestQuote 0`, `verifiedHistoricalCandles 0`, `realtime 0`.
- Storage/queue: memory; QStash not configured.

This branch improves honest declaration, selection and replay. It **does not** create NSE/BSE entitlement. The deployed build will continue to show zero verified India quotes until an authorised provider/plan is supplied.
