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

## Not covered

- Live provider behaviour, Groq latency/rate limits, QStash delivery and PostgreSQL
  against a real instance — all require credentials and are marked unverified in
  the docs rather than simulated as success.
- Browser E2E: the client is verified by a production build and a Vite module
  compile, not by a headless browser run.
