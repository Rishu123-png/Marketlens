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
| Prompt-injection defence | News text in a delimited evidence block, never in the system prompt; instructions repeated in the user turn | Retrieved content is untrusted input |
| Provider key rotation | **Not implemented** | Rotating keys to evade rate limits violates provider terms; instead cache, batch, and limit per client |
