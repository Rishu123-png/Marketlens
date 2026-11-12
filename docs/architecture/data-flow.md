# Data flow and failure behaviour

## Research job lifecycle

```
POST /api/research
  → validate instrument, timeframe, modules, lookback
  → create job (status: queued)
  → 202 { jobId }

worker / same request (short jobs):
  1. resolve instrument (internal ID, exchange, currency)
  2. gather evidence  ─ quotes, candles, news, company facts
  3. validate evidence ─ freshness, gaps, duplicates, cross-source price check
  4. compute indicators ─ deterministic, from step 2 candles
  5. run specialists in parallel (chart, news, sentiment, technical, risk)
  6. validate agent JSON against schemas; retry per policy
  7. coordinator synthesises validated outputs only
  8. publication gate (risk agent + schema checks)
  9. persist job, agent_runs, report, evidence_items
```

## Evidence object

Every number an agent sees must be traceable. The evidence layer emits a single
envelope:

```json
{
  "instrumentId": "IN-EQ-RELIANCE",
  "symbol": "RELIANCE",
  "exchange": "NSE",
  "currency": "INR",
  "quote": {
    "price": 1450.5,
    "changePercent": 0.92,
    "provider": "twelve",
    "providerTimestamp": "2026-11-12T09:30:00+05:30",
    "retrievedAt": "2026-11-12T09:30:02+05:30",
    "freshness": "verified"
  },
  "candles": { "interval": "1day", "count": 250, "first": "2025-11-12", "last": "2026-11-11" },
  "indicators": { "rsi14": 56.4, "macd": { "histogram": 1.2 }, "sma50": 1402.1 },
  "news": [],
  "quality": { "staleQuote": false, "missingCandles": 0, "duplicateNews": 0, "warnings": [] },
  "evidenceIds": ["ev_quote_1", "ev_candles_1"]
}
```

Values above are illustrative, not market data.

## Agent statuses

`pending` → `queued` → `running` → `completed` | `failed` | `skipped`, with
`retrying` between `failed` and `running`.

Report status is derived, never assumed:

| Condition | Report status |
| --- | --- |
| All requested specialists completed, gate passed | `completed` |
| ≥1 specialist completed, ≥1 unavailable, gate passed | `partial` |
| A critical module (technical for chart requests, quote) missing | `blocked` |
| Coordinator failed | `failed` |

## Failure policy

| Failure | Behaviour |
| --- | --- |
| Quote provider timeout | Try next provider; if all fail → `blocked`, no AI call, HTTP 503 |
| Candles insufficient for an indicator | Indicator is `null`; technical agent must state the reading is unavailable |
| News provider down | News + sentiment `skipped` with reason; report is `partial` |
| One agent returns invalid JSON | One retry; still invalid → that section marked unavailable |
| Groq 429 | Exponential backoff, respect `Retry-After`, then `partial` if unresolved |
| Two providers disagree on price beyond tolerance | Risk agent raises a critical warning → publication gate blocks |

Every one of these paths is a test case, not a hope.
