# Architecture decisions

Status values: **proposed** (recommendation awaiting confirmation), **confirmed**,
**superseded**.

The ten product decisions below were answered as a set with the recommended
options. Each recommendation is recorded here as the proposed default so
implementation can proceed; change the status to `confirmed` once you agree, or
edit the `Decision` column and I will adjust the plan.

| # | Question | Proposed decision | Why | Status |
| --- | --- | --- | --- | --- |
| 1 | Market coverage rollout | **India first, global-ready architecture** | Instrument IDs carry country/currency from day one, so adding US symbols is data not refactoring | proposed |
| 2 | Agent execution | **Hybrid**: 5 specialists in parallel, coordinator after | Wall-clock cost is one specialist latency; the coordinator has a hard dependency on all five | proposed |
| 3 | Chart Agent scope | **Chart structure only** (price action, patterns, S/R, volume) | Image interpretation is unverifiable and non-reproducible; numbers come from candles | proposed |
| 4 | News sourcing | **Financial + company sources** (official announcements, filings) | Company facts shouldn't come only from secondary reporting; filings are the primary evidence | proposed |
| 5 | Sentiment sources | **News + permitted public commentary**; analyst opinions only when licensed | Keeps each sentiment claim traceable to a retrievable source | proposed |
| 6 | Risk Agent authority | **Warning + publication gate** | Blocks publication on critical data failures (stale quote, no candles, contradictory sources) but allows a clearly-labelled partial report otherwise | proposed |
| 7 | Report depth | **Multiple depths**: quick, standard, comprehensive | Maps directly onto `requestedModules`; quick = chart+technical, comprehensive = all six | proposed |
| 8 | Launch instruments | **Equities + indices + ETFs** | Indices/ETFs are needed for market context on the Overview page; same quote pipeline | proposed |
| 9 | Storage | **PostgreSQL + object storage**, no warehouse yet | Candles and report JSON grow faster than a row store should; warehouse is premature | proposed |
| 10 | Visual direction | **Hybrid terminal + modern dashboard** | Dense data where it matters (tables, Chart Lab), calmer spacing elsewhere | proposed |

## Technical decisions (not on the form)

| Decision | Choice | Rationale |
| --- | --- | --- |
| Where indicator code lives | `server/indicators/`, plain ESM, no AI | Deterministic, unit-testable, reusable by Chart Lab and agents |
| Indicator output shape | Arrays aligned to input length, `null` where history is insufficient | Makes gaps explicit; callers can't accidentally treat `0` as a reading |
| RSI smoothing | Wilder | Matches the platform convention users compare against |
| Bollinger deviation | Population standard deviation (`ddof = 0`) | Matches TradingView's default |
| Agent output transport | Strict JSON validated against `shared/schemas` | Orchestrator must reject malformed agent output, not "repair" it |
| Progress delivery | Polling first, SSE later | Simpler to run on Vercel; SSE needs a streaming-capable host |
| Instrument identity | Internal IDs (`IN-EQ-RELIANCE`) with exchange/country/currency; provider tickers resolved per adapter, indices only by explicit mapping | Symbols are reused across venues and providers; deriving an index ticker would be a guess |
| Quote access | Everything goes through `server/market-data/gateway.js` | One place for provider order, fallback, caching and the no-fabrication rule |
| Prompt-injection defence | News text in a delimited evidence block, never in the system prompt; instructions repeated in the user turn | Retrieved content is untrusted input |
| Provider key rotation | **Not implemented** | Rotating keys to evade rate limits violates provider terms; instead cache, batch, and limit per client |

## Decisions taken 2026-11-12 (M1)

| # | Decision | Choice | Consequence |
| --- | --- | --- | --- |
| O1 | Durable research execution | **Queue + independently deployed worker (QStash candidate)**; never multi-agent work inside a Vercel request | Job lifecycle is queue-ready; worker/queue land in M5. See [`execution-deployment.md`](./execution-deployment.md) |
| O2 | News sources | **Financial news + official company sources, NSE/BSE announcements, SEBI, RBI, government filings**; sentiment may use permitted public commentary | M4 ingestion must prefer primary sources and record provenance per item |
| O3 | Charting | **Lightweight Charts**, rendering kept separate from calculations | Chart Lab consumes `/api/history` + `/api/indicators`; no pattern logic in the browser |
| O4 | API versioning | **No `/v1` prefix** | Existing paths stay stable; version only when an external consumer exists |
| O5 | Authentication | **Deferred**, architecture stays auth-ready | Research/job endpoints must key on a user identity hook from the start, even while anonymous |
| O6 | Shared storage | **Upstash** for distributed rate limits; **PostgreSQL** for durable data at M8 | Rate limiter already fails over to Upstash; no DB in M1 |

## Technical decisions taken in M1

| Decision | Choice | Rationale |
| --- | --- | --- |
| Validation library | **Zod 4** (`zod@4.6.7`, MIT), server-side only | Runtime validation with useful issue paths; verified absent from the client bundle (build size unchanged) |
| Validation strictness | Unknown keys tolerated, wrong types/missing fields rejected | Provider payloads and agent output carry extra fields; the contract is about required truth, not exhaustive shape |
| Asset class model | Schema accepts 7 classes; API activates `equity/index/etf` only | Data model ≠ activation; other classes need authorised sources |
| Gate authority | Deterministic `server/reports/gate.js`; AI never votes | Risk-agent text can add warnings, never clear or create a block (tested) |
| Gate failure mode | **Fail closed** — internal error yields `BLOCKED` | An unverifiable report must not publish |
| Gate thresholds | Declared in `GATE_THRESHOLDS` with `GATE_RULES_VERSION` | Stored reports remain explainable when rules change |
| Retry policy | 1 retry for 429/5xx/network/timeout and schema-invalid output; none for 4xx/config | Bounded cost; no retry storms |
| Retry-after handling | Honoured up to 5 s, otherwise fail fast | Sleeping 60 s inside a request wastes the budget; the queue can reschedule instead |
| Key rotation | **Rejected** | Six Groq keys are separate credentials, not a rate-limit workaround |
| Cost reporting | Tokens only, no currency conversion | Provider prices change; a fabricated cost figure is worse than none |
| Legacy report path | `api/report.js` now uses the AI abstraction + `analysisReportSchema` | Preserves the HTTP contract (200/400/429/502/503) while removing the direct Groq call |
