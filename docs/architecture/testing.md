# Testing

## Commands

```bash
npm run check   # parse-only syntax guard over api/, server/, lib/, scripts/, tests/
npm test        # Node's built-in test runner (unit + endpoint suites)
npm run build   # production client build (must not shrink b/c of server imports)
npm audit       # dependency audit
```

## Suites

| Area | File | Covers |
| --- | --- | --- |
| Contracts | `tests/unit/schemas.test.js` | zod schemas accept valid, reject malformed |
| Indicators | `tests/unit/indicators.test.js` | Reference values, warm-up nulls, no AI imports |
| Patterns | `tests/unit/patterns.test.js` | Trend labels, pivots, zones, candlesticks, double top, determinism |
| Market data | `tests/unit/gateway.test.js`, `providers.test.js`, `candles.test.js` | Fallback, quote contract, provider mapping, candle validation/cache |
| News | `tests/unit/news.test.js` | Sanitizer, injection flags, RSS/Atom, dedupe, service statuses |
| Agents | `tests/unit/orchestrator.test.js` | All depths with a stub provider, prohibited language, fabricated ids, malformed JSON, coordinator fallback |
| Jobs | `tests/unit/jobs.test.js`, `test/jobs-endpoint.test.js` | Lifecycle, claiming, worker outcomes, queue adapters, endpoints |
| Storage | `tests/unit/storage.test.js` | Migrations, PG repository SQL mapping, report immutability, object storage, SigV4 |
| Gate | `tests/unit/gate.test.js` | Thresholds, fail-closed, gate/report consistency |
| Boundaries | `tests/unit/boundaries.test.js` | No AI in deterministic modules, no server code in the client bundle |
| Endpoints | `test/*.test.js` | Request/response contracts, rate limits, error mapping |

Endpoint tests use a stub AI provider and stubbed `fetch`; no network access and no
credentials are required to run the suite.

## Conventions

- Tests should assert observable behaviour (status codes, schema-valid output,
  recorded failures), not implementation details.
- A test fixture that needs candles must pass schema validation; do not bypass it.
- When a real defect is found, fix the code and add the regression test in the same
  commit (several already exist: candle `evidenceId` mapping, missing gate result,
  empty-symbol instrument synthesis).

## Evidence and tool-calling suites

- `tests/unit/tools.test.js` — deterministic tool reads, argument validation,
  budget exhaustion, the Groq tool loop (stub provider), tool rejection fallback,
  maximum rounds and per-agent tool policy.
- `tests/unit/evidence-sources.test.js` — TTL cache, feed defaults/status, source
  registry states (including NSE `prohibited`), coverage classification and
  runtime downgrade, SEC EDGAR fixtures (UA gate, normalisation, caching),
  AMFI parsing and multi-URL fallback, data.gov.in opt-in behaviour, and the
  honest "configured but failing" limitation.
- `tests/unit/ai-backbone.test.js` — Groq is the only provider id and every agent
  resolves to it; no second provider module exists; evidence adapters never
  import the AI layer; coverage travels in the envelope.
- `test/evidence-endpoints.test.js` — `/api/coverage`, `/api/nav`,
  `/api/official-data` and the Groq/coverage fields of `/api/provider-status`.

All of these run without credentials or network access.

## Not covered

- Live provider behaviour, Groq latency/rate limits, QStash delivery and PostgreSQL
  against a real instance — all require credentials and are marked unverified in
  the docs rather than simulated as success.
- Browser E2E: the client is verified by a production build and a Vite module
  compile, not by a headless browser run.
