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

## M2 — India-first market data `partial`

| Task | Status | Depends on | Notes |
| --- | --- | --- | --- |
| Instrument catalog with stable IDs, IN + US, equity/index/ETF | done | — | 36 instruments; indices need explicit provider mapping |
| Provider adapters (FMP, Twelve, Alpha) + shared gateway | done | — | Adds a provider without touching endpoints |
| Normalized quote with provider/retrieval timestamps + freshness | done | — | `normalize.js` |
| Per-client rate limits on quote/search/batch/instrument routes | done | — | Shared store still pending |
| Finnhub adapter into the gateway | planned | adapter interface | Orphan `api/finnhub.js` retired |
| Provider health/latency monitoring | planned | M12 observability | Health endpoint reports measured status, not just key presence |
| Verify FMP endpoint generation (legacy `/api/v3` vs `/stable`) | awaiting verification | FMP docs access | Primary provider confirmed working against a live key |
| Confirm provider licensing for storage/redistribution | blocked | provider terms review | Gates candle/news persistence |

## M3 — Technical intelligence `partial`

| Task | Status | Depends on | Notes |
| --- | --- | --- | --- |
| Indicator engine | done | — | 24 reference tests |
| `GET /api/indicators` (candles → snapshot, shared with Chart Lab) | planned | M2 candles | Same code path for UI and Technical agent |
| Candle service with cached persistence + `adjusted` flag | planned | storage decision | Never persist unlabelled adjusted prices |
| Pattern detection: pivots, swings, S/R clusters, triangles, wedges, H&S, double/triple tops | planned | candle service | Deterministic, confidence + completion state |
| Reference tests for pattern detection | planned | pattern detection | Fixed candle fixtures per pattern |

## M4 — News and evidence `planned`

Prerequisite: a permitted news source. `NEWS_API_KEY` is declared but unused —
**awaiting configuration** (provider choice + terms).

- [ ] News adapter(s) behind a provider interface; no scraping outside terms.
- [ ] Official filings/announcements source for NSE/BSE (**blocked** until a
      permitted source is chosen).
- [ ] Evidence records with provenance, dedupe fingerprint, verification status.
- [ ] Near-duplicate collapsing (title/ticker/time/content fingerprint).
- [ ] Freshness + category classification (deterministic first, model second).
- [ ] `GET /api/news` with filters and pagination.
- [ ] Untrusted-content handling: excerpts delimited, never concatenated into
      system prompts.

Acceptance: five syndicated copies of one story produce one evidence item.

## M5 — Six agents and orchestration `planned` (execution model decided)

| Task | Depends on |
| --- | --- |
| Agent modules (prompt + input builder + output schema + tests) | M1 schemas, M3 indicators, M4 evidence |
| Orchestrator: job creation, plan, statuses, timeouts, retries, cancellation | M1 lifecycle, M5 agent modules |
| Durable execution (job table + worker), polling API | **decided** — queue + independent worker (QStash candidate); see [`execution-deployment.md`](./execution-deployment.md) |
| Risk pre-analysis validation | M2 data-quality rules |
| Risk post-analysis review + contradiction detection | agents |
| `POST /api/research`, `GET /api/research/:jobId`, `/agents` | orchestrator |

Hosting options to decide: Vercel background functions / queue (QStash) / separate
worker process. Until decided, orchestration can run in-request for Quick depth
only, with the 60 s function limit documented as the constraint.

## M6 — Reports and publication gate `planned`

- [ ] Report section builder per depth (Quick / Standard / Comprehensive).
- [ ] Evidence linking (`report_evidence`), methodology + limitations section.
- [ ] Deterministic gate enforcement in the report path.
- [ ] Partial-report rendering rules; blocked reports never shown as complete.
- [ ] Report persistence + `GET /api/reports`, comparisons.
- [ ] Evaluation dataset: indicator correctness, pattern recall, source
      attribution, contradiction preservation, unsupported-claim rate.

## M7 — Frontend redesign `planned`

Prerequisites: M3 (candles/indicators API), M5 (research endpoints).

- [ ] Router + app shell + design tokens extracted from current CSS.
- [ ] Overview, Markets (catalog filters), instrument detail.
- [ ] Chart Lab (candles, volume, overlays, agent annotations).
- [ ] News Intelligence, AI Research, Agent Monitor, Reports, Settings.
- [ ] Accessibility pass: focus traps, Escape handling, keyboard tables.
- [ ] Chart library decision recorded in `decisions.md`.

Rule: no screen ships against an endpoint that does not exist.

## M8 — Storage, auth, analytics `planned`

- [ ] PostgreSQL schema + migrations (tables in target architecture §10).
- [ ] Object storage for snapshots/exports; retention policy.
- [ ] Authentication + per-user authorisation on jobs, reports, watchlists.
- [ ] Security headers (CSP/HSTS/frame options), request IDs, audit log.
- [ ] Observability: structured logs + provider/agent metrics.
- [ ] Analytics layer designed; deployed later (**deferred**).

## M9 — Global expansion `planned`

Exchange metadata, trading calendars, timezones, currency handling (only through a
validated service), additional provider adapters, and an activation checklist per
asset class — a data model alone never activates an asset class in the UI.

## M10 — Production validation `planned`

Security tests, data-quality tests, agent evaluation against the fixed dataset,
performance/load checks, deployment verification (including the live Vercel URL
and its environment variables), documentation and release checklist.

## Cross-cutting, continuously

- Every new endpoint: validation, rate limit, schema-checked output, tests.
- Every AI call: schema validation, timeout, retry policy, token/cost logging.
- Every provider: adapter + licensing note + coverage test.
- Every claim in docs: marked done / partial / planned / blocked.
