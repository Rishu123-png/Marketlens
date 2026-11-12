# Security

## Secrets

- Provider and AI keys are server-side environment variables only. No `VITE_*`
  variable exists for any provider, and the client bundle is checked by a test
  that fails if zod or server modules leak into it.
- Errors surface provider names and status codes, never headers or key values.
- `WORKER_SECRET` gates `/api/worker`. Without it the endpoint is disabled (503).
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

Production must terminate TLS and set at the edge:

- `Content-Security-Policy` allowing only self, with `connect-src 'self'`
  (the app has no third-party runtime calls; fonts are self-hosted or allow-listed).
- `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`
  (or CSP `frame-ancestors 'none'`).
- API responses: `Cache-Control: no-store` for job and report reads.

These are documented configuration, **not enforced by this repository** — Vercel
`headers` configuration or the edge proxy must set them.

## Authorisation

Authentication is deferred (decision O5). Jobs and reports are therefore
unauthenticated: do not deploy to a public URL with real research data until auth
lands. The data model already carries per-job ownership fields in the schema
design; adding a `user_id` column and a session check is the intended path.

## Known gaps

- Upstash QStash request-signature verification is not implemented; a shared secret
  is used instead.
- No CSRF token is required because state-changing endpoints accept JSON only and
  do not rely on cookies.
- Audit logging of privileged actions (cancelling another user's job) does not
  exist yet because there are no user accounts.

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

