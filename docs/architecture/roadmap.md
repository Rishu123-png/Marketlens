# Implementation roadmap

Milestones with concrete tasks, dependencies, acceptance criteria and honest
status. Status vocabulary matches [`audit.md`](./audit.md): **done**, **partial**,
**planned**, **awaiting configuration**, **blocked**.

## M0 — Repository audit `done`

- [x] Inspect every tracked file, route, provider, AI call, test and config.
- [x] Publish [`audit.md`](./audit.md) (15 sections), preserve/modify/missing lists, risks.
- [x] Publish [`market-lens-target-architecture.md`](./market-lens-target-architecture.md).
- [x] Publish this roadmap.

Acceptance: audit findings are traceable to files and numbers; no destructive change made.

## M1 — Contracts and foundations `done` (2026-11-12)

| Task | Status | Depends on | Acceptance |
| --- | --- | --- | --- |
| Indicator engine (SMA/EMA/RSI/MACD/ATR/Bollinger/relVol) | done | — | Reference-value tests, nulls for insufficient history |
| Syntax guard + CI step | done | — | `npm run check` fails on an unparseable module |
| `shared/schemas` with runtime validation (instrument, quote, candle, evidence, agent run, job, report, gate, analysis) | done | — | Zod 4; malformed shapes rejected; 10 schema tests |
| Research-job lifecycle module (statuses, transitions, timestamps) | done | schemas | Every legal and illegal transition tested (13 tests) |
| Publication-gate rules module | done | schemas | Deterministic gate with thresholds, fail-closed, 32 tests |
| AI provider abstraction (provider, model, temperature, tokens, timeout, retries per agent) | done | schemas | Groq adapter, 20 tests; legacy report path migrated |
| Boundary tests (no AI in gate/indicators/lifecycle, no zod in client bundle) | done | — | 7 tests |
| Move `lib/server/rateLimit.js` → `server/security/rateLimit.js` | deferred | — | Pure moves wait for the M8 security pass; imports are stable today |

No blocking decision remains. M1 shipped with 159 passing tests.

## M2 — India-first market data `done`

| Task | Status | Notes |
| --- | --- | --- |
| Instrument catalog with stable IDs, IN + US, equity/index/ETF | done | 36 instruments; indices require explicit provider mapping |
| Provider adapters (FMP, Twelve, Alpha) + shared gateway | done | Ordered fallback, quote-contract enforcement |
| Historical candles from Twelve Data and Alpha Vantage | done | Validated against `candleSchema`; invalid rows dropped and counted |
| Candle service with short-lived cache | done | 5-minute TTL, 10-candle analysis floor |
| Per-client rate limits on all provider-backed routes | done | Upstash when configured, memory otherwise |
| Independent price cross-check (second provider) | done | Used by the gate when `SECONDARY_MARKET_PROVIDER` is set |
| Provider health/latency monitoring | partial | Status endpoint reports capability + verification level, not live latency |
| Live provider verification | awaiting configuration | Requires real FMP/Twelve/Alpha keys |
| Licensing for storage/redistribution | blocked | Terms review before candle/news persistence |

## M3 — Technical intelligence `done`

- [x] Indicator engine with reference tests (SMA/EMA/RSI/MACD/ATR/Bollinger/relative volume).
- [x] `GET /api/indicators` returning values, engine version and parameters.
- [x] `GET /api/history` returning validated candles with coverage metadata.
- [x] `GET /api/analysis` returning candles + indicators + geometric analysis, with no AI.
- [x] Pattern engine: pivots, trend structure, S/R clusters, candlesticks, double top/bottom,
      H&S, triangles, wedges, channels, flags, with explicit confidence and completion state.
- [x] Deterministic trend fallback for monotonic series (no pivots) using net change.
- [x] Reference tests per pattern family and for insufficient history.

## M4 — News and evidence `done` (feeds awaiting configuration)

- [x] NewsAPI and GNews adapters behind a provider interface.
- [x] Official-source RSS/Atom provider (RBI/SEBI/PIB candidates + `NEWS_RSS_FEEDS`).
- [x] NSE/BSE announcement adapters that fail closed without verified access and mark output `adapter-unverified`.
- [x] Evidence records with provenance, publisher, retrieval time, verification and fingerprint.
- [x] Headline-based dedupe: syndicated copies collapse to one item with a duplicate count.
- [x] Untrusted-content handling: markup/control-character stripping, injection signal flags,
      evidence envelope in prompts; retrieved text never enters a system prompt.
- [x] `GET /api/news`.
- [ ] Confirm official feed URLs, terms and cadence — **awaiting verification** (feeds ship as
      candidates and are only polled when configured or flipped to verified).

## M5 — Six agents, orchestration and durable execution `done`

| Task | Status |
| --- | --- |
| Agent modules (prompt + envelope + output schema + guard) | done |
| Hybrid orchestrator: deterministic data first, parallel specialists, risk, gate, coordinator | done |
| Durable execution: job store, queue adapter, worker, polling API | done (memory + PostgreSQL; QStash publisher implemented, unverified) |
| Deterministic post-checks: prohibited recommendation language, fabricated evidence ids | done |
| Report assembly with sections removed when an agent did not complete | done |
| `POST /api/research`, `GET /api/jobs`, `GET /api/jobs/:jobId`, `POST /api/worker` | done |

Live verification still required: one end-to-end job against Groq with real provider keys, and one
QStash delivery against a deployed worker.

## M6 — Reports and publication gate `done`

- [x] Depth-based report sections (Quick/Standard/Comprehensive) driven by required modules.
- [x] Deterministic gate verdict stored on the job and the report; partial and blocked outcomes.
- [x] Evidence ids and source list on every report; methodology generated in code.
- [x] Report persistence (PostgreSQL, insert-only) and report revisions table.
- [ ] `GET /api/reports` list/detail endpoints — **planned** (job detail returns the report today).
- [ ] Evaluation dataset and scoring harness — **planned**.

## M7 — Frontend terminal `done` (first pass)

- [x] App shell with Overview, Chart Lab and Research views; hash routing; responsive layout.
- [x] Overview preserved: watchlist, filters, provider search, quote modal, single-shot AI report.
- [x] Chart Lab: candlesticks + volume via Lightweight Charts, deterministic structure,
      zones, patterns, indicators and limitations.
- [x] Research Lab: job creation, polling, gate verdict, agent status, report sections,
      evidence trail and recent jobs.
- [x] Client never holds a provider key; every request is same-origin.
- [ ] Accessibility pass beyond focus outlines and labels — **planned**.
- [ ] Instruments/News/Reports screens beyond the three shipped views — **planned**.

## M8 — Storage, security, observability `partial`

- [x] PostgreSQL schema + migrations (jobs, events, agent runs, evidence, reports, revisions).
- [x] Job/report repositories with `FOR UPDATE SKIP LOCKED` claiming and insert-only reports.
- [x] Object storage adapters: filesystem (tested) and S3 SigV4 (implemented, unverified).
- [x] Security documentation: headers, secret handling, injection defence, worker auth.
- [x] Observability documentation: what is logged today, what is missing, how to add it.
- [ ] Authentication and per-user authorisation — **deferred** (architecture auth-ready).
- [ ] Security headers enforced at the edge, request ids and structured audit log — **planned**.
- [ ] Analytics — **deferred**.

## M9 — Global expansion `partial`

India-first coverage is complete for equities/indices/ETFs through the catalog and provider
mappings. Global instruments are supported by the same contracts (US listings are in the
catalog); exchange calendars, timezones and additional asset classes remain **planned** and are
not activated in the UI.

## M10 — Production validation `in progress`

- [x] Full test suite, syntax guard, production build and dependency audit run locally.
- [x] Deployment, security, observability and API references documented.
- [ ] Live provider and Groq verification, QStash delivery, PostgreSQL migration run.
- [ ] Load/performance checks and an agent evaluation dataset.

## Cross-cutting, continuously

- Every new endpoint: validation, rate limit, schema-checked output, tests.
- Every AI call: schema validation, timeout, retry policy, token/cost logging.
- Every provider: adapter + licensing note + coverage test.
- Every claim in docs: marked done / partial / planned / blocked / awaiting configuration.
