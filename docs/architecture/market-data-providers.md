# Market-data provider comparison — India-first

**Audit date:** 2026-11-12
**Scope:** configured adapters (`fmp`, `twelve`, `alpha`) for NSE/BSE equities, indices, daily history, intraday candles, quotes, quotas, licensing and reliability.
**Method:** documentation review **plus** the production response codes and messages observed in `/api/diagnostics` on the same day. Marketing pages were not treated as evidence of an entitlement. No plan was purchased and no account setting was changed.

## 1. Bottom line

| Question | Answer |
| --- | --- |
| Can the current **free** keys provide NSE/BSE intraday candles? | **No.** None of the three configured free tiers documents an NSE/BSE intraday entitlement. |
| Can they provide NSE/BSE **daily** candles? | Not reliably on the current plans. Alpha Vantage documents BSE daily series; Twelve Data sells NSE/BSE **EOD** on Grow; FMP documents India only in its Ultimate/global tier. |
| Can they provide a **verified latest quote** for NSE/BSE? | Entitlement is the blocker, not the quote contract. On 2026-11-12 the production run observed **0** verified quotes. |
| Is any provider a licensed real-time NSE/BSE feed? | No. All three are aggregators; NSE/BSE display/redistribution still requires an exchange licence. |
| What should be bought or changed? | **Nothing without approval.** The code now reports the missing entitlement explicitly and stops re-hitting exhausted providers. |

## 2. Observed behaviour in production (2026-11-12)

These are actual responses recorded by the market-data diagnostics, not vendor claims:

| Provider | Observed result | Meaning |
| --- | --- | --- |
| FMP | `403` from the retired legacy quote endpoint before the adapter rewrite | The old `/api/v3/quote` path is gone. The adapter now uses the documented stable endpoints (`/stable/quote`, `/stable/historical-price-eod/full`, `/stable/historical-chart/{interval}`). The new code has not yet been re-verified against the live key at audit time. |
| Twelve Data | `429` — free credits exhausted (952+ credits had been used) | Free Basic is **800 requests/day, 8/minute**. Retrying does not create credits. |
| Alpha Vantage | quota exhausted | Free key is **25 requests/day**. Retrying does not create credits. |
| Coverage | catalogued `160`, provider-mapped `160`, quote-enabled `160`, verified latest `0`, intraday successes `0` | Mapping is not coverage. Zero live prices were verified. |

The 403/429/quota results are the reason the new orchestration layer fails closed: a provider-level circuit opens after a rate-limit, permission or quota response, and the remaining budget is not spent on repeated attempts.

## 3. India-first capability matrix

“Documented” means the vendor’s own documentation/plan page. “Observed” means this deployment’s actual response. A blank/intraday `—` is not implemented as synthetic data.

| Provider | NSE equity | BSE equity | Indices | Historical daily | Intraday (NSE/BSE) | Latest quote | Free allowance | Minimum plan that documents India | Commercial / display |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **FMP** | `.NS` mapping implemented; entitlement **not verified** | `.BO` mapping implemented; entitlement **not verified** | Some index symbols; mapped only, not verified | Stable EOD endpoint implemented; 5,000-row pages | Stable intraday endpoint implemented; **not documented for India below Ultimate** | Stable quote implemented; no `currency` field | Basic $0: 250 calls/day, EOD, US coverage | **Ultimate** — global coverage, 30+ years, 1-minute intraday | Display/redistribution needs a separate FMP Data Display & Licensing Agreement |
| **Twelve Data** | `NSE:SYMBOL` mapping; **Grow** entitlement required | `BSE:SYMBOL` mapping; **Grow** entitlement required | Mapped only where explicit; not part of current catalogue | `time_series` implemented; daily = 1 credit/symbol | **Not documented on individual plans for NSE/BSE** (exchange list marks XNSE/XBOM **EOD**) | `/quote` implemented; checks `meta.currency` on candles | Basic $0: 8 credits/min, 800/day, **US equities/ETFs/forex/crypto only**; no production/display rights | **Grow** (20+ markets, NSE/BSE EOD); Pro/Ultra add markets and WS | Basic: development/evaluation, no display or production. Grow: internal display. External display/redistribution starts at business plans. |
| **Alpha Vantage** | No documented NSE mapping; adapter tries `.NSE` then `.BSE` for quotes | `SYMBOL.BSE` documented for daily; weekly/daily implemented | Not verified | `TIME_SERIES_DAILY` / `TIME_SERIES_WEEKLY`; BSE fallback implemented | **No India intraday entitlement documented**; intraday endpoint is premium | `GLOBAL_QUOTE`; no currency/exchange metadata in the response | Free: ~25 requests/day (community/observed; vendor now presents premium tiers) | Paid premium removes the tiny daily allowance, but India intraday/NSE daily is still not a documented entitlement | Commercial use requires contacting sales; US real-time is separately regulated |

### Intervals

| Interval | FMP | Twelve Data | Alpha Vantage | Honest result today |
| --- | --- | --- | --- | --- |
| `1day` | `/stable/historical-price-eod/full` | `time_series&interval=1day` | `TIME_SERIES_DAILY` (BSE fallback) | Best chance of EOD data; still capped by quota/entitlement |
| `1week` | Not claimed (adapter returns unsupported) | `interval=1week` (entitlement applies) | `TIME_SERIES_WEEKLY` | Available only when a provider entitlement + quota allow it |
| `1month` | Not claimed | `interval=1month` (entitlement applies) | Not implemented | Unavailable unless a provider explicitly supports it |
| `1min`–`1h` | Stable intraday endpoint; **Ultimate for India** | Endpoint supports intervals; **NSE/BSE EOD only on individual plans** | Premium intraday; **no India entitlement documented** | **Unavailable** on current plans — shown as a reason, never filled |
| `4h` | Derived by aggregating 1h candles | Derived by aggregating 1h candles | Not supported | Only when a 1h feed exists |

## 4. Quotas, rate limits and cost (documented/observed)

| Provider | Free quota | Paid entry | Notes |
| --- | --- | --- | --- |
| FMP | 250 calls/day; Basic is EOD/US | Starter $19/mo (US), Premium $49/mo (US/UK/Canada, intraday charts), Ultimate $99/mo annual (global, 1-min) | FMP's own pricing page lists **Global Coverage** only at Ultimate. Intraday charts appear at Premium, but India is not in Premium's coverage list. |
| Twelve Data | 8 credits/min, 800/day; Basic is US equities/ETFs/forex/crypto | Grow from **$79/mo** (377 credits/min; 20+ markets; NSE/BSE EOD); Pro $229/mo (70+ markets) | Individual plans are internal/non-display; business plans are separate. A `time_series` request is one credit per symbol. |
| Alpha Vantage | ~25 requests/day (observed; free key) | Premium from **$49.99/mo** (75 req/min), $99.99+ for real-time US | No daily cap on paid plans, but India intraday is not a documented entitlement. |

**No purchase, upgrade, plan change, trial or key rotation was performed.** Prices and entitlements must be rechecked before any purchase decision.

## 5. Licensing and redistribution (India)

NSE's [Data Sharing & Usage Policy](https://www.nseindia.com/static/market-data/nse-data-policy) restricts redistribution and requires a separate licence for commercial use; BSE data is likewise licensed (real-time/bulk/commercial reuse generally requires registration and a data agreement). A vendor API key does **not** grant the right to display raw NSE/BSE prices to end users.

Implications for MarketLens:

- Storing responses for internal analytics/backtesting and showing **derived analysis** may be permitted under some vendor licences, but showing raw exchange prices/OHLCV/charts to users is a display/redistribution question that must be answered in writing by the exchange or an authorised vendor.
- Twelve Data Basic explicitly forbids production/display use.
- FMP requires a separate display/licensing agreement.
- Alpha Vantage directs commercial users to sales.
- Do not treat a successful HTTP 200 as a licence.

## 6. Reliability and API behaviour

| Provider | Uptime/status evidence | Failure modes observed | Adapter behaviour after this audit |
| --- | --- | --- | --- |
| FMP | No public SLA found; no status page used as evidence | Legacy endpoint `403`; plan/endpoint errors returned as JSON | Stable endpoints only; payload errors classified; 403 opens a 6-hour circuit; no bare-ticker fallback |
| Twelve Data | Paid Ultra advertises 99.95% SLA; free tier has no SLA | `429` after credits exhausted | 429 opens a circuit; no automatic key rotation; one request per symbol/interval |
| Alpha Vantage | No SLA found | Daily quota notice in a 200 JSON body; invalid symbol messages | Quota notice stops before the second exchange suffix and opens the circuit; invalid-symbol messages do not poison the circuit |

Provider response headers are read for quota metadata (`x-ratelimit-remaining*`, credits remaining/used). They are stored without URLs, keys or other headers. When Upstash Redis is configured the circuit/quota state is shared; otherwise it is per serverless instance and diagnostics say so.

## 7. Symbol and price-unit validation

| Instrument | FMP | Twelve Data | Alpha Vantage | Currency/price unit |
| --- | --- | --- | --- | --- |
| TCS (NSE) | `TCS.NS` | `NSE:TCS` | `TCS.NSE` (then `TCS.BSE` for quotes/candles) | Catalogue currency **INR**. FMP stable quotes do not return a currency field, so the adapter cannot independently prove INR; it does send the `.NS` listing and validates the returned exchange when present. Twelve candles validate `meta.currency` against INR and reject mismatches. Alpha `GLOBAL_QUOTE` has no currency/exchange metadata. |
| TCS (BSE) | `TCS.BO` | `BSE:TCS` | daily `TCS.BSE` | INR; same metadata limitation as above. |
| HINDUNILVR (NSE) | `HINDUNILVR.NS` | `NSE:HINDUNILVR` | `HINDUNILVR.NSE` / `.BSE` | INR; same caveat. |
| HINDUNILVR (BSE) | `HINDUNILVR.BO` | `BSE:HINDUNILVR` | `HINDUNILVR.BSE` | INR. |
| `M&M` | `M&M.NS` | `NSE:M&M` | `M&M.NSE` / `.BSE` | The ampersand must be URL-encoded by the adapter (it is). A bare `M&M` is never sent. |

**GBp/pence risk:** the catalogue used by this deployment contains NSE/BSE/INDEX/NASDAQ/NYSE listings in INR/USD, not LSE pence-quoted lines. If an LSE or GBp instrument is added later, the adapter must not infer currency: FMP stable quotes and Alpha `GLOBAL_QUOTE` cannot prove the unit, and a pence value would otherwise look like pounds. Add an explicit currency/unit mapping before adding such instruments.

## 8. Recommendation (no purchase)

1. **Keep the current code deployed.** It correctly separates supported/configured/verified and stops repeated quota burn. This is the production-safe state.
2. **To make NSE/BSE daily + quote actually work**, either:
   - obtain an FMP plan that documents India (Ultimate/global) or a Twelve Grow plan for NSE/BSE **EOD**, subject to display licensing; **and/or**
   - contract an India-licensed vendor whose agreement covers display/redistribution.
3. **Do not buy intraday from these three on the assumption that it covers NSE/BSE.** FMP intraday for India is Ultimate; Twelve marks NSE/BSE EOD; Alpha has no documented India intraday entitlement.
4. **Do not add a fourth provider with a free key** merely to make the chart green. Every new source needs a licensing review and the same identity/currency checks.
5. Until an entitlement exists, Chart Lab must show “unavailable from configured providers” for intraday and the Diagnostics page must show the exact circuit reason and retry time.

## 9. Evidence links

- FMP pricing: <https://site.financialmodelingprep.com/developer/docs/pricing>
- FMP stable quote: <https://site.financialmodelingprep.com/developer/docs/stable/quote>
- FMP EOD full: <https://site.financialmodelingprep.com/developer/docs/stable/historical-price-eod-full>
- FMP intraday: <https://site.financialmodelingprep.com/developer/docs/stable/intraday-5-min>
- Twelve Data pricing: <https://twelvedata.com/pricing>
- Twelve Data exchanges (NSE/BSE EOD): <https://twelvedata.com/exchanges?level=grow>
- Alpha Vantage documentation (BSE examples): <https://www.alphavantage.co/documentation/>
- Alpha Vantage premium: <https://www.alphavantage.co/premium/>
- NSE data policy: <https://www.nseindia.com/static/market-data/nse-data-policy>
- BSE data/BSE API licensing overview: <https://www.bseindia.com/> (BSE Self Data Feed terms apply)
