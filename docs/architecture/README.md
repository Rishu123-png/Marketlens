# Market Lens — Architecture

Market Lens is a market research and intelligence terminal for Indian and global
markets. It produces evidence-linked research reports from deterministic market
data plus six specialist AI agents (Groq), and it never places orders.

This directory is the engineering reference. The product blueprint is captured
here so implementation decisions stay traceable to a decision.

| Document | Purpose |
| --- | --- |
| [`current-state.md`](./current-state.md) | What exists in this repository today, and the gap analysis |
| [`decisions.md`](./decisions.md) | The ten architecture decisions and their status |
| [`data-flow.md`](./data-flow.md) | Quote → evidence → agents → report, with failure behaviour |
| [`agents.md`](./agents.md) | Specialist agent contracts: inputs, outputs, prohibitions |

## Layered system

```
┌──────────────────────────────────────────────────────────────┐
│ Frontend (React + Vite)   Overview · Markets · Chart Lab      │
│                           News · Research · Agents · Reports  │
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

## Target repository layout

The blueprint's target structure, mapped onto what exists today.

```
market-lens/
├── src/                     # React app (exists; single-file today)
│   ├── app/ components/ pages/ services/ hooks/ stores/ utils/ styles/
├── api/                     # Vercel serverless entrypoints (exists)
├── server/                  # NEW: domain logic, imported by api/
│   ├── orchestrator/
│   ├── agents/{chart,news,sentiment,technical,risk,coordinator}/
│   ├── market-data/{providers,adapters,normalization}/
│   ├── indicators/          # ← delivered in M1
│   ├── evidence/ reports/ database/ cache/ validation/ security/
├── shared/{schemas,constants}/
├── tests/{unit,integration,agents,data}/   # `test/` today
├── docs/                    # ← this directory
```

Rule: `api/` files stay thin — parse/validate the request, delegate to
`server/`, format the response. All logic that needs a test lives in `server/`
or `shared/`.
