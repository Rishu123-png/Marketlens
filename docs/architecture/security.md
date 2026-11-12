# Security

## Secrets

- Provider and AI keys are server-side environment variables only. No `VITE_*`
  variable exists for any provider, and the client bundle is checked by a test
  that fails if zod or server modules leak into it.
- Groq credentials are resolved per agent by `server/ai/credentials.js` using
  `GROQ_API_KEY_<AGENT>` and the shared `GROQ_API_KEY` fallback. The provider
  receives the credential explicitly; it has no implicit env fallback.
  `GROQ_AGENT_KEYS_REQUIRED=true` forbids shared fallback and fails the agent.
- Telemetry, diagnostics and status endpoints carry only the environment-variable
  NAME and `dedicated | shared | none`. They never carry a key, prefix or
  Authorization header. Separate keys do not multiply organisation/project
  rate limits; 429s are surfaced and never bypassed by key rotation.
- Errors surface provider names and status codes, never headers or key values.
- `/api/worker` accepts either a verified Upstash QStash signature (HS256 JWT,
  current/next signing keys, expiry + body digest) or `WORKER_SECRET`. With
  neither configured it is disabled (503). Signature verification fails closed
  when the runtime cannot supply the raw body.
- `/api/research` refuses to create jobs when `GROQ_API_KEY` is absent.

## Untrusted input

Two kinds of untrusted input exist: request bodies and retrieved text.

**Request bodies** are validated before use: symbols against a strict regex,
intervals and depths against allow-lists, limits clamped, bodies capped at 256 KB.

**Retrieved text** (news, filings, excerpts) is treated as data:

1. Markup, scripts, control characters and bidi overrides are stripped.
2. Excerpts are capped at 1,200 characters in evidence records.
3. Instruction-like patterns are detected and recorded as `metadata.injectionSignals`
   (`ignore-instructions`, `system-prompt`, `role-override`, `prompt-leak`,
   `price-instruction`, `encoded-blob`).
4. Evidence enters prompts inside `<evidence>` blocks in the **user** message, with an
   explicit reminder that it is data. Article text is never interpolated into a
   system prompt.
5. Syndicated copies collapse by headline fingerprint, so repetition cannot look
   like confirmation.

Flagged text is still passed to the agent — as evidence, with the flag — because
hiding it would conceal a real signal. The system prompt states that directives
inside evidence are to be ignored.

## Model output

Model output is not trusted either:

- Every agent response is parsed and validated against a zod schema; failures are
  recorded as `FAILED` with the reason and the section is removed from the report.
- A deterministic guard rejects recommendation language ("buy rating", "price
  target", "guaranteed returns", "will definitely rise", …).
- Cited evidence ids must exist in the envelope; unknown ids fail the agent.
- The publication gate is deterministic and fail-closed. Risk-agent text can add
  warnings; it cannot clear or create a block.

## Rate limiting

`lib/server/rateLimit.js` uses Upstash Redis when `UPSTASH_REDIS_REST_URL`/`_TOKEN`
are configured, otherwise an in-process counter. Per-route limits are set at the
handler (quote 60/min, research creation 10/min, worker deliveries secret-gated).

## Headers and transport

`vercel.json` now enforces:

- `Content-Security-Policy` with `default-src 'self'`, `script-src 'self'`,
  `connect-src 'self'`, allow-listed Google Fonts and `frame-ancestors 'self'`.
- `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`,
  `Permissions-Policy` disabling camera/microphone/geolocation/payment.

API responses carry `X-Request-Id`; errors include the same `requestId` so an
operator can correlate a structured log line with a user report. `LOG_REQUESTS=off`
disables per-request logging.

## Authorisation

There are no user accounts. Instead, research-job ownership is a high-entropy
bearer value generated in the browser (`x-owner-id`); only its SHA-256 hash is
stored (`research_jobs.owner_hash`, migration 002). A job with an owner hash
returns `404` to every caller that does not present the matching value; job lists
are scoped the same way. Jobs created before this change have no owner and remain
legacy-readable.

This closes anonymous enumeration of jobs and reports. It is **not** account
authentication: clearing browser storage loses access to those jobs, and a stolen
owner value is a stolen bearer token. Account login/SSO remains outstanding.

## Known gaps

- No account system, password reset, session revocation or admin roles.
- No CSRF token is required because state-changing endpoints accept JSON only and
  do not rely on cookies.
- Audit logging of privileged actions is limited to structured request logs and
  job transition events; there are no operator accounts to audit yet.

## AI tool calls

Groq may call four tools (`read_candles`, `read_indicator`, `search_evidence`,
`read_evidence`). They are a fixed allow-list implemented in application code,
not model-generated code:

- a tool can only read the current run's evidence envelope;
- attempts to call anything else return an error to the model;
- arguments are schema-validated, result size and call count are capped;
- no tool performs a network request, reads a file, or touches `process.env`;
- tool use is recorded on the stored agent run for audit.

## Official-source access rules enforced in code

- `SEC_USER_AGENT` must contain a contact email, otherwise the EDGAR adapter is
  disabled rather than sending anonymous requests.
- SEC requests are serialised to at most 10 per second and cached.
- No NSE scraper exists; the NSE cookie path is opt-in and documented as
  legally fragile.
- AMFI NAV is labelled delayed; it is never returned as a quote.

