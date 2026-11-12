# TradingAgents adaptation — architecture, free-data strategy and coverage

**Date:** 2026-11-12  
**Reference:** [`TauricResearch/TradingAgents`](https://github.com/TauricResearch/TradingAgents) (Apache-2.0)  
**Scope:** Market Lens, India first, ₹0 data budget, research only. No prediction-market, wagering or order-execution functionality exists in this repository.

## 1. What was studied, and what was not copied

The upstream Python files were read for architecture, not ported:

| Upstream | Pattern extracted | Market Lens adaptation |
| --- | --- | --- |
| `graph/trading_graph.py` | One run has a saved configuration and a report tree; graph-shape choices are part of run identity. | `server/orchestrator/reproducibility.js` records run id, instrument, timestamps, candle range, providers, models, agent outputs, evidence references, gate and report id. |
| `default_config.py` | Explicit runtime configuration, typed env overrides and bounded debates/tool rounds. | Existing depth/module config plus provider registry v2 and a six-call tool budget per agent run. No new paid services. |
| `dataflows/router.py` | Ordered vendor chain; configured vendors are not silently replaced by unlisted ones; typed vendor failures. | Existing gateway keeps the configured order and circuit policy; typed/classified failures already skip to the next provider. Registry v2 adds declared exchanges/intervals/entitlement/licensing and per-instrument selection plans. |
| `dataflows/symbols.py` | Central symbol normalisation, explicit aliases, safe ticker components, no provider-specific guessing at call sites. | `shared/instruments/catalog.js` remains the only identity source. TCS NSE/BSE, HINDUNILVR, NIFTY 50, NIFTY Bank and derivatives are resolved by internal id/exchange, never by bare symbol. |
| `dataflows/errors.py` | Behaviour-based taxonomy: unavailable vs not-configured vs no-usable-data/stale. | Existing HTTP/provider classification and circuit breaker remain authoritative; registry exposes configured/supported/attempted/succeeded/validated as separate states. |
| `graph/setup.py`, `analyst_execution.py` | Analysts run in parallel; debate starts after analysts; risk review is independent; report is written only at the end. | Existing `Promise.all` chart+technical and news+sentiment, then risk, deterministic gate, then coordinator. Coordinator now produces bull/bear/neutral scenarios with evidence and uncertainty. |
| `agents/researchers/*`, `risk_mgmt/*` | Bull and bear argue from the same reports; risk/neutral review challenges both. | The six-agent contract is preserved. The coordinator supplies three conditional scenario readings; the risk agent independently reviews completeness, freshness, reliability, conflicts and unsupported claims. |
| `reporting.py` | Deterministic report tree plus settings header; missing sections are removed, not filled. | Existing report builder discards coordinator text for failed sections and now adds a deterministic scenarios section. Replay returns the stored report rather than re-running analysis. |
| `memory/` | Lessons from prior decisions. | **Not ported.** No outcome-settlement loop, no trade decision, no portfolio action. |

No upstream source code was copied. If any is reused later, the Apache-2.0 licence and attribution must be retained. The upstream project's prediction-market vendor is deliberately excluded.

## 2. Provider registry v2

Code: `server/market-data/registry.js` (version `2.0.0`). The registry is declarative; the gateway still performs execution and validation.

Each active provider declares:

- exchanges and instrument types;
- quote support, freshness (`delayed-or-eod`) and an explicit `realtime: false` claim;
- daily/weekly/monthly/intraday candle support and the intervals the adapter accepts;
- free-tier quota and whether quota headers exist;
- India/global entitlement, verification level and observation date;
- display/redistribution licensing and permitted use;
- runtime health, circuit and quota, merged from `providerPolicy`.

| Provider | Exchanges declared | India free tier | Quote | Candles | Real-time | Licensing stance |
| --- | --- | --- | --- | --- | --- | --- |
| FMP | NSE, BSE, NASDAQ, NYSE, AMEX | **No** — paid/entitled account required | delayed/EOD, not verified | daily + plan-gated intraday | **not claimed** | separate display/redistribution agreement |
| Twelve Data | NSE, BSE, NASDAQ, NYSE, AMEX | **No** — Basic is US-only; NSE/BSE EOD is Grow | delayed/EOD | daily/weekly/monthly + intraday capability | **not claimed** | internal research only until licensed |
| Alpha Vantage | NSE, BSE, NASDAQ, NYSE, AMEX | **No** — free tier documents BSE daily only | delayed/EOD | daily/weekly only | **not claimed** | sales/contact for commercial use |
| Yahoo Finance | evaluated only | **rejected** | none | none | none | Yahoo ToS §2.4.9 prohibits automated collection without prior written permission |

**Yahoo/yfinance decision:** rejected for automated use. Yahoo's Terms of Service prohibit accessing or collecting data using automated means without express prior permission; yfinance itself states the API is intended for personal use only. No live Yahoo request was made by Market Lens, because making one to "test behaviour" would itself be the automated collection the terms prohibit. The documented behaviour (unofficial endpoint, no SLA, no exchange licence, session/cookie fragility) is sufficient to reject it. It remains a documented candidate only if written permission is obtained; it is not registered and has no adapter or environment variable.

A provider's declared exchange list is **not** an instrument-level entitlement. Mapping, configuration, interval support and entitlement are reported separately.

## 3. ₹0 data strategy

| Data class | Source strategy | Honest status |
| --- | --- | --- |
| Verified daily/historical candles | FMP stable EOD, Twelve daily, Alpha daily (BSE fallback) | Implemented. Coverage is zero until a configured account returns validated rows. |
| Genuinely delayed quotes | Same providers, only after identity/schema validation | Implemented. No provider is called real-time. |
| Intraday | Only where an adapter declares the interval | Declared but plan-gated for India; no silent EOD substitution. |
| Official announcements / regulatory | Existing official RSS and filing sources, SEBI/RBI-style evidence registry | Independent of market-price providers. |
| Official macro datasets | Existing data.gov.in adapter, optional key | Optional and reported as unavailable when not configured. |
| Depth/order book, tick data | **Not purchased and not fabricated** | Unavailable. |
| Prediction markets / wagering | **Not implemented** | Out of scope by product decision. |

The gateway never creates a placeholder price, volume or depth. Missing data stays missing and is accounted for in diagnostics.

## 4. Exchange-aware instrument identity

`shared/instruments/catalog.js` is the single identity source. Each record carries internal id, trading symbol, company name, exchange, country, currency, asset type, sector and explicit provider mappings where known. Provider tickers for Indian equities follow `.NS`/`.BO` (FMP), `NSE:`/`BSE:` (Twelve) and `.NSE`/`.BSE` (Alpha) conventions. Indices and derivatives require explicit mappings and are never guessed.

Verified identity examples:

| Instrument | Internal id | Exchange | Type | Currency | Provider mapping |
| --- | --- | --- | --- | --- | --- |
| Tata Consultancy Services | `IN-EQ-TCS` | NSE | equity | INR | FMP `TCS.NS`, Twelve `NSE:TCS`, Alpha `TCS.NSE` |
| Tata Consultancy Services | `IN-EQ-TCS-BSE` | BSE | equity | INR | FMP `TCS.BO`, Twelve `BSE:TCS`, Alpha `TCS.BSE` |
| Hindustan Unilever | `IN-EQ-HINDUNILVR` | NSE | equity | INR | FMP `HINDUNILVR.NS`, Twelve `NSE:HINDUNILVR` |
| Nifty 50 | `IN-IDX-NIFTY50` | NSE | index | INR | FMP `^NSEI`; Twelve/Alpha **unmapped** |
| Nifty Bank | `IN-IDX-NIFTYBANK` | NSE | index | INR | FMP `^NSEBANK`; Twelve/Alpha **unmapped** |
| Nifty 50 front-month future | `IN-FUT-NIFTY50-FRONT` | NSE | future template | INR | **none**; lot 65 verified from NSE circular NSE/FAOP/70616, effective 2025-12-30 |
| Nifty Bank front-month future | `IN-FUT-NIFTYBANK-FRONT` | NSE | future template | INR | **none**; lot 30 verified from the same circular, effective 2025-12-30 |
| Nifty 50 ATM option | `IN-OPT-NIFTY50-ATM-FRONT` | NSE | option template | INR | **none**; expiry/strike intentionally unpinned |

Derivative entries are **identity templates**, not live contracts: a front-month expiry changes monthly, so pinning one would silently become stale. No configured zero-budget provider supplies Indian derivative quotes or candles, and the registry returns `selected: null` for them. Lot sizes are marked `verified` only because the NSE circular ``NSE/FAOP/70616`` (2025-10-03) was read directly; they must still be reloaded from the exchange contract file before any trading use.

## 5. Gateway state ladder

The gateway (`server/market-data/gateway.js`, `candles.js`) owns ordered fallback, cache-first behaviour, in-flight deduplication, per-provider timeouts, quota-aware circuits, identity validation, timestamp normalisation, candle integrity checks and missing-row accounting. Diagnostics distinguish:

1. **Configured** — an env var exists.
2. **Supported** — the adapter has a provider ticker and the capability/interval.
3. **Attempted** — a request was actually made.
4. **Succeeded** — the provider returned a 2xx response.
5. **Validated** — identity and schema checks passed and the observation was recorded.
6. **Coverage state** — real-time / delayed / EOD / stale / unavailable.

Only step 5 contributes to verified coverage. An HTTP 200 alone contributes only to step 4.

## 6. Controlled tool calling

`server/agents/tools.js` exposes seven controlled read tools plus four backward-compatible aliases. Every tool reads the run envelope; none has `fetch`, an HTTP import, `process.env` or a provider URL.

| Tool | What it reads | Network? |
| --- | --- | --- |
| `get_quote` | validated quote in the envelope | No |
| `get_historical_candles` | recent supplied candles | No |
| `get_instrument_info` | resolved identity and derivative metadata | No |
| `get_technical_indicators` | deterministic indicator snapshot | No |
| `get_company_news` | company news/filing evidence already retrieved | No |
| `get_market_events` | regulatory/official/market-event evidence | No |
| `get_market_overview` | quote freshness, candle range, coverage, warnings | No |
| `read_candles`, `read_indicator`, `search_evidence`, `read_evidence` | aliases | No |

`server/ai/toolPolicy.js` grants tools per agent (chart, news, sentiment by default; technical/risk can be enabled explicitly) and `AI_TOOL_CALLING=off` disables all of them. The six-call budget per agent run is unchanged. Chart loading and indicator calculation remain deterministic and do not use Groq.

## 7. Scenarios and independent risk review

The coordinator output contract now requires:

- `bullish`, `bearish` and `neutral` scenarios;
- a thesis, supporting `evidenceIds`, conditions, uncertainty and invalidation for each;
- no probabilities, price targets, expected returns or advice.

The deterministic output guard rejects unknown evidence ids anywhere in the nested output, including scenario citations. The risk agent separately reviews completeness, freshness, reliability, conflicts and unsupported claims and remains advisory; the deterministic gate is authoritative.

## 8. Reproducibility and replay

`runResearch` now returns:

- `runId` and `runConfig`;
- `dataSnapshot` (exact quote, candles, indicators, chart, structure, evidence and snapshot hash);
- `reproducibility` metadata;
- the existing report, agent runs, gate and versions.

Persistence adds `run_config` and `data_snapshot` JSONB columns to `research_job_results` (migration `004_run_reproducibility.sql`). `GET /api/jobs/{jobId}/replay` returns the stored report, evidence, configuration and data snapshot. It makes **no provider or model call** and refuses with `409` if no report exists rather than fetching a new series.

## 9. Diagnostics workspaces

The frontend now has two separate workspaces:

- **Coverage** (`#coverage`): provider registry, exchange/interval matrix, per-instrument mapping/configuration/verification, quota/circuit health, last attempts and the real-time/delayed distinction.
- **AI Usage** (`#ai-usage`): six-agent credential routing by env-var **name**, models, token usage, recent runs and tool rounds.

The existing combined Diagnostics view remains. Neither workspace allows AI health to imply data coverage, or vice versa.

## 10. Known limitations

- Free/developer tiers do not provide authorised NSE/BSE real-time data. Verified India quote/candle coverage remains zero without a paid entitlement or licensed vendor.
- FMP, Twelve and Alpha free quotas are small; circuits prevent hammering but cannot create credits.
- Yahoo/yfinance is not used because its terms prohibit automated collection without permission.
- Indian derivative entries are identity templates, not tradable/current contracts; no provider is mapped.
- Report replay reconstructs the stored artefact; it does not re-run deterministic calculations or re-validate the original source after the fact.
- Provider declarations and pricing can change; the registry records a verification date and must be re-audited.
