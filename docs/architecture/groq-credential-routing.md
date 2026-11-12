# Groq credential routing and Data & AI diagnostics

## Root cause of the credential-routing defect

Before this change:

- `server/ai/config.js` selected a model per agent.
- `server/ai/runAgent.js` passed that configuration to the provider.
- `server/ai/providers/groq.js` defaulted every request to
  `process.env.GROQ_API_KEY`.

No layer resolved a per-agent credential, so all six agents necessarily shared
one key even when separate variables were present. There was also no central
place to report which variable was used.

## Routing model

`server/ai/credentials.js` is the only credential selector:

| Agent | Dedicated variable |
| --- | --- |
| chart | `GROQ_API_KEY_CHART` |
| technical | `GROQ_API_KEY_TECHNICAL` |
| news | `GROQ_API_KEY_NEWS` |
| sentiment | `GROQ_API_KEY_SENTIMENT` |
| risk | `GROQ_API_KEY_RISK` |
| coordinator | `GROQ_API_KEY_COORDINATOR` |

Rules:

1. A non-empty dedicated variable always wins.
2. If it is absent, `GROQ_API_KEY` is used only when fallback is permitted
   (`GROQ_SHARED_KEY_FALLBACK` is not `off` and strict mode is off).
3. `GROQ_AGENT_KEYS_REQUIRED=true` disables fallback; a missing dedicated key
   fails that agent with the missing variable's name.
4. The resolver reports the selected variable NAME and `dedicated | shared |
   none`; the value is handed only to the provider call.
5. The provider has no implicit environment default. A missing key is a
   configuration error, not a shared-key request.
6. Separately named keys isolate credentials and per-key accounting. They do not
   multiply an organisation's/project's Groq rate limit. 429 responses and
   retry-after are surfaced; keys are never rotated to evade quota.

## Telemetry

Each `AgentRun` may now carry:

`credentialEnvName`, `credentialMode`, `requestCount`, `httpStatus`, `rateLimit`
(remaining requests/tokens/reset strings), plus the existing `attempts`,
`retries`, `usage`, `durationMs`, `modelFallback` and `error`.

`server/ai/telemetry.js` keeps a bounded in-process history. `GET
/api/provider-status` exposes per-agent configured/missing status and
`GET /api/diagnostics` exposes the full AI panel. Neither contains secret values,
prefixes or Authorization headers. Upstream error text is redacted if it echoes a
key.

## Market-data diagnostics

`server/market-data/observations.js` records one safe event per provider attempt
and cache hit:

instrument, symbol, exchange, interval, requested limit, provider, attempted,
HTTP status, error message, returned/dropped counts, cache hit, duration, data
timestamp and freshness.

No full URLs, query strings or credentials are recorded. `/api/diagnostics`
returns this alongside coverage, mapping checks (TCS/HINDUNILVR provider tickers),
provider configuration and a state glossary. It is deliberately separate from
the AI panel.

## Tests

`tests/unit/credential-routing.test.js` calls the real Groq adapter with a mocked
HTTP transport for all six agents, inspects the Authorization header, and checks
dedicated/shared/strict behaviour, rate-limit metadata and secret non-disclosure.
`tests/unit/market-diagnostics.test.js` covers candle/quote request telemetry,
cache hits, dropped rows, provider HTTP failures, interval capability and mapping
checks. `tests/unit/chart-data.test.js` proves Chart Lab requests
`/api/history` before `/api/analysis` and never fabricates candles.
