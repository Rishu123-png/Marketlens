# Market Lens — Architecture

Market Lens is a market research and intelligence terminal for Indian and global
markets. It produces evidence-linked research reports from deterministic market
data plus six specialist AI agents (Groq), and it never places orders.

This directory is the engineering reference. The product blueprint is captured
here so implementation decisions stay traceable to a decision.

| Document | Purpose |
| --- | --- |
| [`audit.md`](./audit.md) | Milestone 0 audit: what exists today, file by file, with risks and gaps |
| [`market-lens-target-architecture.md`](./market-lens-target-architecture.md) | The agreed target: layers, schemas, orchestration, gate, storage, API |
| [`roadmap.md`](./roadmap.md) | Milestones M0–M10 with tasks, dependencies, acceptance criteria and status |
| [`decisions.md`](./decisions.md) | Decision log, including open decisions |
| [`data-flow.md`](./data-flow.md) | Quote → evidence → agents → report, with failure behaviour |
| [`agents.md`](./agents.md) | Specialist agent contracts: inputs, outputs, prohibitions |
| [`api.md`](./api.md) | Every route, its contract, error shapes and the job flow |
| [`testing.md`](./testing.md) | Suites, conventions, what is and is not covered |
| [`security.md`](./security.md) | Secrets, untrusted input, model-output guards, headers, gaps |
| [`evidence-sources.md`](./evidence-sources.md) | Permitted/prohibited sources, adapters, caching and coverage states |
| [`environment-audit.md`](./environment-audit.md) | Every environment variable, plus retirement proposals (nothing deleted) |
| [`observability.md`](./observability.md) | What is logged today, what is missing, how to add it |
| [`groq-credential-routing.md`](./groq-credential-routing.md) | Per-agent Groq credential resolution, telemetry and the AI vs market diagnostics split |

## Layered system

```
┌──────────────────────────────────────────────────────────────┐
│ Frontend (React + Vite)   Overview · Chart Lab · Structure    │
│                           Screener · News · Watchlists        │
│                           Portfolio · Research · Diagnostics  │
└───────────────────────────────┬──────────────────────────────┘
                                │  same-origin /api/* (no secrets in browser)
┌───────────────────────────────▼──────────────────────────────┐
│ API gateway  validation · request IDs · rate limits · errors  │
└───────────────────────────────┬──────────────────────────────┘
┌───────────────────────────────▼──────────────────────────────┐
│ Research orchestrator  jobs · agent scheduling · statuses     │
└───────┬──────────────────────────────────────┬───────────────┘
        │                                      │
┌───────▼───────────────────┐      ┌───────────▼──────────────┐
│ Evidence layer            │      │ AI research department   │
│ quotes · candles · news   │      │ chart · news · sentiment │
│ indicators · validation   │      │ technical · risk · coord │
└───────┬───────────────────┘      └───────────┬──────────────┘
        │                                      │
┌───────▼──────────────────────────────────────▼───────────────┐
│ Report & storage engine  evidence-linked reports · history    │
└──────────────────────────────────────────────────────────────┘
```

## Non-negotiable invariants

These already hold in the current code and must survive the redesign.

1. **No fabricated market data.** A price is shown only when a provider returned
   it. Missing values render as `—`, never as an estimate or a demo value.
2. **AI never sources current market facts.** Agents receive server-fetched,
   normalized evidence; browser-supplied prices are ignored (enforced in
   `api/report.js` and covered by `test/report.test.js`).
3. **Deterministic code computes, the model interprets.** Indicators are
   calculated in `server/indicators/`, never by an LLM.
4. **Missing sections stay missing.** If an agent fails, the report says the
   section is unavailable instead of inventing content.
5. **Retrieved text is evidence, not instructions.** News and filing content are
   untrusted input and must never be concatenated into a system prompt.
6. **Research only.** No order placement, no brokerage credentials, no
   "guaranteed return" language.

## Repository layout (as built)

```
market-lens/
├── src/                      # React + Vite terminal
│   ├── main.jsx              # shell + hash view routing
│   ├── components/           # AppChrome, PriceChart, IndicatorPane, coverage
│   ├── views/                # 9 workspaces: Overview, ChartLab, Structure,
│   │                          Screener, News, Watchlists, Portfolio, Research,
│   │                          Diagnostics
│   ├── lib/                  # api client, market client, legacy helpers
│   └── styles.css            # design tokens + terminal styles
├── api/
│   └── index.js              # the ONLY Vercel function: routes /api/* (Hobby: ≤12)
├── handlers/                 # one thin handler per route (not counted by Vercel)
│   ├── health, instruments, universe, search, market, top-stocks, finnhub
│   ├── history, indicators, analysis, coverage, nav, official-data
│   ├── news, provider-status
│   ├── report                       # single-shot AI commentary
│   ├── research, jobs, jobs/[jobId] # durable research jobs
│   └── worker                       # queue delivery entry point
├── server/
│   ├── market-data/          # gateway, normalize, candles, providers/*
│   ├── indicators/           # deterministic indicators
│   ├── patterns/             # deterministic chart structure
│   ├── news/                 # sanitize, rss, feeds, providers/*, filings, service
│   ├── agents/               # prompt, guard, envelope, six agents
│   ├── orchestrator/         # research.js, jobLifecycle.js
│   ├── reports/              # gate.js, report.js
│   ├── ai/                   # config, usage, runAgent, providers/groq.js
│   ├── jobs/                 # store, queue, worker
│   └── storage/              # pg, migrations, pgJobStore, reports, objects
├── shared/
│   ├── schemas/              # primitives, instrument, quote, candle, evidence,
│   │                         # agent, agentOutputs, gate, research, analysis
│   └── instruments/catalog.js
├── lib/                      # shared browser/server config (stock universe)
├── scripts/                  # dev server, worker, syntax guard
├── tests/unit/               # unit suites
├── test/                     # endpoint suites
└── docs/architecture/        # this directory
```

Rule: handlers stay thin — parse/validate the request, delegate to `server/`,
format the response. All logic that needs a test lives in `server/` or `shared/`.

Routing rule: `server/http/router.js` holds the static route table
(`handlers/` → `/api/...`). `api/index.js` is the only file under `api/`, because
every file there becomes a Vercel Serverless Function and the Hobby plan allows
12. `vercel.json` rewrites `/api/:path*` to `/api?__path=:path*`; a plain
`api/[...path].js` would only match one path segment outside Next.js. Adding a
route means adding a handler, an entry in the router table, and a test — not a
new file in `api/`.

## Current status (2026-11-12)

Implemented and tested: contracts, an instrument master with 160 curated listings
and provider-directory merge, venue-aware quotes, candles, indicators, chart
patterns, deterministic market structure, market overview, screener, news/filing
evidence, six agents with hybrid orchestration, deterministic gate, durable jobs
with owner scoping and QStash signature verification, PostgreSQL schema and
repositories, report assembly, per-agent Groq credential routing, and nine
terminal workspaces including virtual portfolio, alerts and Data & AI
diagnostics.

Implemented but not verified against a live service in this environment: quote
and candle providers, Groq calls, QStash delivery, PostgreSQL migrations, S3
SigV4 uploads, and NSE/BSE announcement access. See [`roadmap.md`](./roadmap.md) and [`security.md`](./security.md).
