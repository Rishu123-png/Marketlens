# Market Lens — target architecture

Agreed reference for building Market Lens out of the current repository.
Companion documents: [`audit.md`](./audit.md) (what exists),
[`roadmap.md`](./roadmap.md) (order of work), [`agents.md`](./agents.md) (agent
contracts), [`data-flow.md`](./data-flow.md) (execution and failure paths),
[`decisions.md`](./decisions.md) (decision log).

Status tags used below: **built**, **planned**, **deferred**, **blocked**.

## 1. Principles that are already enforced in code

These are invariants, not aspirations. Anything that breaks them is a regression.

1. No price is shown or analysed unless a provider returned it.
2. Browser-supplied prices never reach the AI layer (enforced in `api/report.js`).
3. Deterministic code computes indicators; models interpret them.
4. Missing evidence produces a missing section, never a filled one.
5. Retrieved text is data, never instructions.
6. Research only — no order placement, no return promises.
7. Provider identity, timestamps and freshness travel with every number.

## 1a. Status after M1 (2026-11-12)

| Contract | Where | Status |
| --- | --- | --- |
| Instrument, quote, candle, evidence, agent run, job, report, gate | `shared/schemas/` (Zod 4) | **Built** |
| Job lifecycle + gate-consistent transitions | `server/orchestrator/jobLifecycle.js` | **Built** |
| Deterministic publication gate | `server/reports/gate.js` (`GATE_RULES_VERSION` 1.0.0) | **Built** |
| AI provider abstraction, per-agent config, retries, token usage | `server/ai/` | **Built** (Groq adapter) |
| Orchestrator, worker, queue | `server/orchestrator/` (rest) | **Planned — M5** |
| News/filings ingestion, evidence store | — | **Planned — M4** |

## 2. Layers

```
Frontend (React + Vite)            Overview · Markets · Chart Lab · News
                                   Research · Agents · Reports · Settings
        │ same-origin /api/*, no secrets in the browser
API gateway                        validation · request IDs · rate limits ·
                                   error contract · (auth in M8)
        │
Research orchestrator              jobs · plans · dependencies · retries ·
                                   timeouts · partial results · cancellation
        │
Evidence & market intelligence     instruments · quotes · candles · indicators ·
                                   news · filings · commentary · validation
        │
AI research department             chart · news · sentiment · technical ·
                                   risk (pre + post) · coordinator
        │
Report engine & storage            evidence-linked reports · history ·
                                   comparison · audit trail
```

Built today: frontend (single page), API gateway (validation, rate limits, error
contract), and the subset of the evidence layer covering instruments, quotes,
candles and indicators. Orchestrator, agents, report engine and storage are
planned.

## 3. Canonical schemas

Schemas live in `shared/schemas/` (built with Zod 4) and are validated at runtime
at every trust boundary: provider payload → internal, agent output → orchestrator,
API body → handler. Validation is server-side only; the client bundle does not
import them.

| Schema | Key fields | Notes |
| --- | --- | --- |
| `Instrument` | `id`, `symbol`, `name`, `exchange`, `country`, `currency`, `assetType`, `sector`, `providers`, `timezone`, `sessionCalendar` | **Built** minus timezone/calendar; company vs listing split is planned |
| `Quote` | `instrumentId`, `price`, `change`, `changePercent`, `open`, `previousClose`, `dayHigh`, `dayLow`, `volume`, `provider`, `providerTimestamp`, `retrievedAt`, `freshness` | **Built** |
| `Candle` | `time`, `open`, `high`, `low`, `close`, `volume`, `source`, `adjusted` | **Built** minus `adjusted`, which is required before candles are persisted |
| `IndicatorSnapshot` | `candles`, `lastClose`, `movingAverages`, `rsi`, `macd`, `atr`, `bollinger`, `relativeVolume`, `volumeBaseline` | **Built**; add `calculationVersion` + `timeframe` |
| `Evidence` | `id`, `sourceType`, `publisher`, `url`, `publishedAt`, `retrievedAt`, `instrumentIds`, `excerpt`, `verification`, `dedupeFingerprint` | Planned (M4) |
| `AgentRun` | `agent`, `status`, `startedAt`, `completedAt`, `durationMs`, `retries`, `provider`, `model`, `promptVersion`, `schemaVersion`, `output`, `error` | Planned (M5) |
| `ResearchJob` | `jobId`, `instrumentId`, `depth`, `timeframe`, `historyPeriod`, `newsLookbackDays`, `requestedModules`, `status`, `gate`, timestamps, `history` | **Built** (execution M5) |
| `ResearchReport` | `reportId`, `jobId`, `sections`, `agentStatus`, `evidenceIds`, `gate`, `methodology`, `createdAt` | **Built** (storage M6/M8) |

Every agent output carries `agent`, `status`, `schemaVersion`, `evidenceIds`,
`confidence`, `limitations` and an `instrumentId`; malformed output is rejected,
not repaired.

## 4. Market data and providers

Provider interface (**built**, `server/market-data/providers/*`):

```js
{ id, label,
  isConfigured(): boolean,
  supports(instrument): boolean,      // false when no ticker can be resolved
  fetchQuote(instrument): Promise<Quote>,
  fetchCandles?(instrument, opts),     // M3
  search?(query) }                     // M4 (fold in api/search.js)
```

Rules: no provider reaches an endpoint directly; `gateway.js` owns order
(`PRIMARY_MARKET_PROVIDER`), fallback and caching. Adapters never fabricate a
ticker — explicit mapping wins, equities/ETFs derive by exchange convention,
indices without a mapping are `unsupported`.

New providers require: adapter + tests, a catalog mapping strategy, and a
documented licensing position on storage/redistribution. Adding a provider must
not touch any agent or endpoint.

## 5. The six agents

Full contracts in [`agents.md`](./agents.md). Summary of division of labour:

| Agent | Exclusive responsibility | Explicitly not its job |
| --- | --- | --- |
| Chart | Price structure, S/R zones, candlestick + advanced patterns, volume behaviour | Computing indicators; interpreting chart images |
| News | What happened; classification; dedupe; primary-source preference | Judging public mood |
| Sentiment | How the information is expressed/perceived | Establishing facts; inferring buy/sell flows |
| Technical | Interpreting deterministic indicator values | Calculating them |
| Risk | Data quality, contradictions, uncertainty, gate input | Forcing agreement; overriding the deterministic gate |
| Coordinator | Synthesis, disagreements, requested depth | Inventing missing sections |

Pattern detection (**planned**, M3) is deterministic code over candles — pivot
detection, swing highs/lows, triangle/wedge/head-and-shoulders heuristics with
confidence and completion state. The Chart agent explains detections; it does not
produce them by looking at an image.

## 6. Orchestration

Job lifecycle (**built** in `server/orchestrator/jobLifecycle.js`; orchestration
and durable execution are M5):

```
CREATED → VALIDATING → (BLOCKED | QUEUED) → RUNNING → (COMPLETED | PARTIAL | FAILED | CANCELLED)
```

Execution graph — hybrid, with one real dependency:

```
validate evidence ─→ risk(pre) ─┬─→ chart ────────────────┐
                                ├─→ technical ─────────────┤
                                └─→ news ─→ sentiment ─────┤
                                                            ├─→ risk(post) → coordinator → gate → store
```

- `chart` and `technical` are independent → parallel.
- `sentiment` depends on the News evidence set (not on the News agent's prose):
  it can start once evidence exists, but runs after dedupe.
- `risk` runs twice: pre-analysis validation and post-analysis review.
- `coordinator` runs only after all specialists reach a terminal state (including
  `SKIPPED`/`FAILED`, which it must report rather than mask).

Agent statuses: `PENDING · QUEUED · RUNNING · COMPLETED · FAILED · RETRYING ·
SKIPPED · BLOCKED`. Retry policy: at most one retry for schema-invalid output and
transient provider errors; no retry on validation failures.

Durable execution: a serverless request must not host the whole job (**blocked on
hosting decision** — see roadmap M5). Job records persist first; workers pick up
`QUEUED` jobs. Polling first; SSE later.

## 7. Publication gate (deterministic)

The gate is code, not a model. The Risk agent supplies evidence and
recommendations; `server/reports/gate.js` (**built**, `GATE_RULES_VERSION` 1.0.0)
computes the verdict from explicit rules, with thresholds in `GATE_THRESHOLDS`:

| Verdict | Conditions |
| --- | --- |
| `BLOCKED` | Instrument identity unresolved · currency/venue mismatch · no verified quote · candles below the minimum for a requested technical/chart module · contradictory critical quotes beyond tolerance · mandatory agent output missing or schema-invalid · requested depth cannot be honoured |
| `PASS_WITH_WARNINGS` | Optional module failed/skipped · news coverage below threshold · small sentiment sample · quote stale within tolerance · single-provider quote (no cross-check) · partial timeframe coverage |
| `PASS` | All mandatory checks satisfied, no warnings above threshold |

Rules are unit-tested (32 gate tests) and an internal evaluation failure fails
closed as `BLOCKED`. A `BLOCKED` report may be stored for diagnostics but must
never render as completed research.

## 8. Research depths

| | Quick | Standard (default) | Comprehensive |
| --- | --- | --- | --- |
| Modules | quote, technical, chart (basic), risk | + news, sentiment | + patterns, filings, multi-timeframe, comparisons |
| Lookback | ~3 months daily | ~1 year daily, 2 timeframes | 2+ years, 4+ timeframes |
| Timeframes | 1D | 1D, 1W | 15m/1H/4H/1D/1W/M |
| Token budget | small | medium | large |
| Gate | mandatory checks still apply | mandatory checks still apply | mandatory checks still apply |

Depth changes evidence coverage, never validation strictness.

## 9. API surface

Existing routes are preserved (they are in use by the current UI). Proposed
additions follow the same `/api/<resource>` convention; no `/v1` prefix until an
external consumer exists (**deferred** decision, recorded in `decisions.md`).

| Group | Route | Status |
| --- | --- | --- |
| Instruments | `GET /api/instruments`, `?q=`, `?id=` | **built** |
| Quotes | `GET /api/market` | **built** |
| Candles | `GET /api/history` | **built** (no persistence) |
| Indicators | `GET /api/indicators?symbol=&interval=` | planned (M3) |
| News/filings | `GET /api/news` | planned (M4) |
| Research | `POST /api/research`, `GET /api/research/:jobId`, `/agents`, `/report` | planned (M5–M6) |
| Reports | `GET /api/reports`, `GET /api/reports/:id` | planned (M6) |
| Watchlists | `GET/POST /api/watchlists`, `DELETE /api/watchlists/:id` | planned (M8, needs auth) |
| Markets | `GET /api/markets` (venues, sessions, calendars) | planned (M9) |

Every handler: validate → rate limit → delegate to `server/` → map errors to
`{ error, details? }` with an appropriate status. Request IDs (**planned**) are
returned in `x-request-id` and included in logs.

## 10. Storage

Three tiers, introduced in the order the data justifies them:

1. **PostgreSQL (M8)** — `instruments`, `instrument_provider_symbols`,
   `companies`, `exchanges`, `research_jobs`, `agent_runs`, `research_reports`,
   `evidence_items`, `report_evidence`, `watchlists`, `user_preferences`,
   `audit_log`. Reports store the section JSON plus immutable `evidenceIds` and a
   `snapshotRef`; history is never rewritten in place.
2. **Object storage (M8)** — raw provider snapshots, candle exports, report
   exports, reproducibility artifacts. Retention and access policy documented
   before upload.
3. **Analytics (M8+, deferred)** — job performance, agent reliability, provider
   latency/error rates, sentiment trends. Interfaces designed now, deployed only
   when volume justifies.

Until M8, caches remain in-process; nothing may depend on them for correctness.

## 11. Security

Built: server-only secrets, `.env` hygiene, input validation, per-client rate
limits, sanitised errors, dependency audit, runtime schema validation of AI
output and agent envelopes.

Required before public research features: authentication + per-user authorisation
on jobs/reports; security headers (CSP, HSTS, frame options); request IDs and
audit logging; schema validation for agent output; untrusted-content handling for
news text; per-user usage budgets; documented retention and export policy.

Never: secrets in `VITE_*` variables, credentials in the repository, provider-key
rotation to bypass limits, scraping sources contrary to their terms.

## 12. Observability

Planned: structured JSON logs with `requestId` + `jobId`; counters/timers for
provider latency and errors, agent duration/failures/retries, cache hit rate,
token use and estimated cost, job completion/partial/blocked rates, data
freshness. Started as in-process instrumentation behind a small module so a real
backend can be attached without touching call sites.

## 13. Frontend

Eight routes, one shell, shared table/chart primitives: Overview, Markets, Chart
Lab, News Intelligence, AI Research, Agent Monitor, Reports, Settings.

Design direction: dark terminal, restrained electric-blue accents, dense data
tables, explicit freshness labels, no chatbot aesthetic. Chart library
(**deferred** decision, M7) — candidates are a lightweight candle renderer vs a
general charting library; the choice is constrained by bundle size and whether
overlays are drawn by us.

Current `src/main.jsx` is preserved as the Overview prototype until the router and
shared components exist; it is not deleted in place.

## 14. Structure mapping

```
shared/instruments/     built  ← identity and provider mapping
server/indicators/      built  ← deterministic calculations
server/market-data/     built  ← providers, normalization, gateway
server/pattern-detection/ planned M3
server/evidence/        planned M4
server/agents/          planned M5
server/orchestrator/    planned M5
server/reports/         planned M6 (sections, gate, comparison)
server/database/        planned M8
server/security/        planned M8 (rateLimit moves here)
shared/schemas/         planned M1.5
src/app|pages|components planned M7
```

Existing conventions win where they are sound: ESM everywhere, no build step for
server code, no runtime dependencies beyond React/Vite, `node --test` for tests.
