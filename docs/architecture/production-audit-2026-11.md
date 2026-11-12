# Production audit — November 2026

Scope: the reported production symptoms on
`https://marketlens-pi.vercel.app/` — only 40 instruments, search limited to
those, 1/40 instruments with a verified quote, TCS at ₹37.45, blank prices, a
“Data Feed Connected” badge over near-zero coverage, and HINDUNILVR reporting
that no provider returned a verified quote.

This audit is read-only about provider entitlements: no subscription was added,
no key was rotated and no market value was fabricated. Every finding below is
reproducible from the code and from provider documentation.

## 1. TCS ₹37.45 — wrong listing, not a bad price

**Cause.** `server/market-data/providers/fmp.js` tried the exchange-suffixed
ticker (`TCS.NS`) and, when that returned nothing, retried the **bare** ticker
`TCS`. On Financial Modeling Prep, `TCS` is The Container Store on NYSE, quoted
in USD. The adapter then normalised that payload against the Indian instrument,
so the response carried `symbol: "TCS"`, `currency: "INR"`, and a plausible but
completely wrong price (₹37.45 instead of Tata Consultancy Services).

**Fix.**
- Indian instruments are only requested with their exchange suffix
  (`.NS` / `.BO`); the bare-ticker fallback was removed.
- `server/market-data/identity.js` now rejects a quote when the provider reports
  a different currency, or a venue that conflicts with the instrument's listing.
  The TCS regression is covered by `test/market.test.js`.
- Alpha Vantage now uses `.NSE` / `.BSE`, never a bare Indian ticker; Twelve uses
  `NSE:` / `BSE:` based on the instrument's own exchange.

## 2. Why only 40 instruments and why search stopped there

**Cause.** `shared/instruments/catalog.js` held a fixed 40-row snapshot and
`/api/instruments` searched exactly that array. `/api/search` forwarded the query
to whichever providers had keys and returned only Indian matches; with no usable
provider response it returned `404`, so the UI appeared to search 40 symbols.

**Fix.**
- The bundled master now holds 160 curated instruments (NSE equities across
  sectors, BSE listings, Indian and US indices, ETFs), still with stable IDs and
  explicit provider tickers.
- `server/instruments/directory.js` merges provider symbol directories (FMP
  stock list, Twelve reference list) into search when a key/plan permits. The
  directory is cached for six hours, bounded, and reports
  `available | stale | unavailable | unfetched` with per-provider errors.
- `/api/instruments` supports pagination up to 500, multi-value filters
  (`assetType`, `exchange`, `country`, `sector`), and provider availability per
  result. `/api/search` searches the merged master first and only then adds
  provider symbol-search results; it no longer 404s when local matches exist.
- Search is no longer India-only: US/global listings from the master or provider
  search are returned with their exchange and asset type.

## 3. Why only one of forty had a verified quote

**Cause.** Configuration is not entitlement. A provider key that is present may
still lack a plan that serves NSE/BSE quotes, may be rate-limited, or may not map
a symbol at all. The old UI collapsed all of that into “connected” as soon as
`/api/top-stocks` returned one row, and the quote gateway dropped failures
without recording them.

**Fix.**
- `server/market-data/observations.js` records per-instrument quote/candle
  attempts, successes, failures, provider and timestamps (per instance, bounded,
  explicitly non-durable).
- The coverage matrix (`/api/instruments?coverage=1`, embedded in
  `/api/coverage`) reports catalogued vs provider-mapped vs quote-capable vs
  actually verified, plus candle coverage, freshness class and provider
  failures. Provider capability no longer implies a verified quote.
- `/api/top-stocks` now returns attempted/verified/unverified counts and its
  coverage label instead of silently omitting failures.

## 4. “Data Feed Connected” over near-zero coverage

**Cause.** `AppChrome` set the green light when `data.stocks.length > 0`.

**Fix.** The status light reads the instrument matrix: it shows
`QUOTES n/catalogued VERIFIED`, turns amber when providers are capable but
nothing is verified, and red when no quote provider is configured. The words
“connected” and “live” are no longer used for coverage. Every response states
`delayed` and that free provider tiers are not exchange-licensed real-time feeds.

## 5. HINDUNILVR “no provider returned a verified quote”

**Cause.** Same class of failure as §3, with a specific mapping gap: the old
gateway tried providers in a fixed order and discarded the per-provider reason.
For HINDUNILVR the reason is preserved now: either the provider lacks an NSE
entitlement, the symbol is not in its directory, or it is rate-limited.

**Fix.** `/api/market` still returns `503` with a `details` array naming each
provider's failure; the UI renders those reasons instead of a generic error.
Instrument-level availability is visible before a quote is requested.

## 6. Timestamps, units and freshness

- All prices keep the provider's currency and the instrument's identity; a
  cross-currency response is rejected rather than relabelled.
- `retrievedAt` is the server observation time; `providerTimestamp` is the
  provider's own timestamp when supplied and stays `null` otherwise.
- NSE session status is computed in `Asia/Kolkata` from a clock only; the
  holiday calendar is labelled `not-verified`.
- Freshness is `delayed` for every provider-backed quote. The observation window
  for “verified now” is 15 minutes; older observations are not reused as current.

## Remaining limitations (not fixed by this audit)

1. **Entitlements.** If the configured plans do not serve NSE/BSE data, coverage
   stays low. The platform now says so precisely; it cannot create a licence.
2. **Provider directory.** It depends on plan access and is not a complete
   exchange master. BSE/NSE official masters are not scraped.
3. **Durability of observations.** Per serverless instance; resets on cold start.
4. **Real-time.** No provider used here is labelled real-time.
5. **Market cap.** Not supplied by the quote adapters, so the screener refuses
   market-cap filters instead of approximating them.
