# Production verification — 2026-11-12

Commit under test: `4bcf4ec` (merged as PR #5). Production deployment:
`https://marketlens-pi.vercel.app`.

A temporary, fixed-prompt credential probe was deployed for this run and removed
immediately afterwards. It accepted no caller prompt and returned only variable
names, modes, request counts and usage.

## Live Groq requests

| Agent | Credential variable | Mode | Status | Requests | Total tokens | HTTP |
| --- | --- | --- | --- | ---: | ---: | ---: |
| chart | `GROQ_API_KEY_CHART` | dedicated | COMPLETED | 1 | 154 | 200 |
| news | `GROQ_API_KEY_NEWS` | dedicated | COMPLETED | 1 | 154 | 200 |
| sentiment | `GROQ_API_KEY_SENTIMENT` | dedicated | COMPLETED | 1 | 154 | 200 |
| technical | `GROQ_API_KEY_TECHNICAL` | dedicated | COMPLETED | 1 | 154 | 200 |
| risk | `GROQ_API_KEY_RISK` | dedicated | COMPLETED | 1 | 154 | 200 |
| coordinator | `GROQ_API_KEY_COORDINATOR` | dedicated | COMPLETED | 1 | 154 | 200 |

Aggregate in-process usage before probe: 0 requests / 0 tokens.
After probe: 6 requests / 702 prompt tokens / 222 completion tokens / 924 total.
This is application-side evidence of one Groq request per dedicated key. Groq
Console access is not available to the agent; the Console should show the
corresponding per-key request and token increase.

## Market data, separate from Groq

`GET /api/history?symbol=TCS&exchange=NSE&interval=1day&limit=120` returned 503:

- FMP: provider does not supply candles.
- Twelve Data: HTTP 429, daily credits exhausted (952 used, limit 800).
- Alpha Vantage: returned no candles.

`GET /api/history?symbol=HINDUNILVR&exchange=NSE&interval=1week` returned 503
with the same Twelve Data 429 and Alpha empty response.

`GET /api/history?symbol=TCS&exchange=NSE&interval=5min` returned 503:

- FMP: provider does not supply candles.
- Twelve Data: HTTP 429, daily credits exhausted.
- Alpha Vantage: provider does not support this interval (no request attempted).

No candles were fabricated. The market-data request never calls Groq: aggregate
AI usage stayed at 6 requests (the six probe requests) across the history calls
in the same run.

## Provider failures observed

Quote requests in production also failed for plan/endpoint reasons:

- FMP: HTTP 403, legacy quote endpoint no longer supported for this account.
- Twelve Data: HTTP 429, per-minute and daily credit limits.
- Alpha Vantage: free-tier 25 requests/day limit.

These are provider entitlement/quota conditions, not Groq routing failures.
