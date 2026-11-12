# Evidence sources

Status: implemented in `server/evidence/` and `server/news/`; live reachability of
each endpoint is **unverified in this environment** (see "Verification status").

Market Lens needs market facts before it needs prose. This document records which
external sources we may use, how, and what happens when they are missing. Three
rules drive every decision here:

1. **No invented market data.** Groq never supplies prices, candles, volume,
   NAVs or filings. Those come from adapters or the user; otherwise the platform
   says the data is unavailable.
2. **Official and documented first.** Regulator and exchange feeds, SEC EDGAR and
   AMFI are preferred over commercial free tiers. Scraping is not a fallback.
3. **Missing is a state, not an error to hide.** `/api/coverage` and the coverage
   strip in the UI state which capabilities are available, partial, degraded or
   unavailable, and why.

## Permission matrix

| Source | Interface | Official | Status in code | Access notes |
| --- | --- | --- | --- | --- |
| RBI | RSS (`pressreleases_rss.xml`, `notifications_rss.xml`, `speeches_rss.xml`) | ✅ | `server/news/feeds.js`, polled by default | Documented feeds; excerpts only. |
| SEBI | RSS (`https://www.sebi.gov.in/sebirss.xml`) | ✅ | `server/news/feeds.js`, polled by default | Documented feed for press releases, circulars, orders. |
| PIB | RSS (`RssMain.aspx?ModId=6&Lang=1`) | ✅ | `server/news/feeds.js`, polled by default | Documented feed; ministry feed ids vary. |
| BSE | RSS page (`beta.bseindia.com/rss-feed.html`) | ✅ | Feed supported through `BSE_ANNOUNCEMENTS_RSS` | BSE advertises feeds; URLs are not a stable published contract, so the operator supplies one. BSE's internal JSON API is **not** used. |
| NSE | Announcements RSS via archives host | ⚠️ | Supported only through `NSE_ANNOUNCEMENTS_RSS` | NSE terms prohibit systematic automated collection without written consent. Off by default; enabling it is an operator legal decision. |
| NSE | Website / undocumented JSON | ❌ | Refused, listed as `prohibited` in the registry | Requires NSE written consent or a licensed vendor. No scraper exists. |
| AMFI | `spages/NAVAll.txt` (+ portal/NavOpen fallbacks) | ✅ | `server/evidence/amfiNav.js`, `/api/nav` | No key. End-of-day NAV; never presented as a live price. |
| SEC EDGAR | `data.sec.gov/submissions`, `companyfacts`, `company_tickers.json` | ✅ | `server/evidence/secEdgar.js`, US instruments only | 10 req/s, mandatory descriptive `User-Agent` with contact email, responses cached ≥1 h. |
| data.gov.in | OGD `resource/{id}` API | ✅ | `server/evidence/dataGovIn.js`, `/api/official-data` | Free key required; per-dataset licence; low limits; macro/reference data only, no OHLCV. |
| Financial Modeling Prep | HTTP JSON | ⚠️ commercial | existing market-data provider | Free tier rate-limited/delayed. |
| Twelve Data / Alpha Vantage | HTTP JSON | ⚠️ commercial | existing candle providers | Free tiers are rate-limited and not exchange-licensed. |
| NewsAPI.org / GNews | HTTP JSON | ⚠️ commercial | existing news providers | Free tiers restrict commercial use and delay articles. |

Two entries in the matrix are deliberately *not* integrations: the NSE scraper
is refused, and BSE's internal API is refused. Both are recorded in
`server/evidence/registry.js` so the decision is visible at runtime instead of
living only in documentation.

## Adapters and what they return

| Module | Returns | Cached |
| --- | --- | --- |
| `server/news/providers/rss.js` | Headlines/excerpts from enabled feeds, with `metadata.feedId` and `liveVerified: false` | via `server/news/service.js` (3 min) |
| `server/evidence/secEdgar.js` | Normalised filing evidence (`sourceType: "filing"`, `verification: "verified"`), plus XBRL `latestFact` | ticker map 24 h, submissions 1 h, facts 24 h |
| `server/evidence/amfiNav.js` | Official NAV for one ISIN or AMFI scheme code | full NAV file 6 h |
| `server/evidence/dataGovIn.js` | Records from one OGD resource | per query 12 h |
| `server/evidence/cache.js` | Shared TTL cache with hit/miss/failure counters | — |

`server/evidence/coverage.js` combines the registry with the environment and the
cache counters into the payload behind `/api/coverage`. The same summary is
embedded in every agent envelope (`quality.coverage`), so agents can state
coverage limits rather than implying they saw data they did not.

### Capability states

| State | Meaning |
| --- | --- |
| `available` | At least one official source is usable and nothing required is missing. |
| `partial` | An official source works, but another required source needs configuration. |
| `degraded` | Only non-official/third-party sources are usable. |
| `unavailable` | No usable source; the platform must not produce that kind of data. |

`liveVerification: "unverified"` means the publisher documents the interface and
we poll it, but no request from this deployment has succeeded yet.

## Caching and request reduction

- Official RSS: evidence cache 3 min per instrument/query; feeds are fetched
  concurrently with a 5 s timeout, and one failing feed does not fail the search.
- AMFI: the entire NAV file is fetched at most every 6 hours and parsed once.
- SEC EDGAR: ticker map and company facts 24 h, submissions 1 h; client-side
  serialisation keeps the platform within 10 requests/second.
- data.gov.in: per-query 12 h cache; `limit` is clamped to 100.
- Candles keep their existing 5 min cache; indicators are always recomputed from
  cached candles rather than re-requested.

## Verification status

| Item | Verified here? |
| --- | --- |
| Official feed URLs reachable from this sandbox | ❌ (outbound access restricted) |
| BSE RSS feed URL | ❌ (`BSE_ANNOUNCEMENTS_RSS` operator-supplied) |
| SEC EDGAR live response | ❌ (adapter tested against fixtures; requires `SEC_USER_AGENT`) |
| AMFI live file | ❌ (parser and fallback logic tested against fixtures) |
| data.gov.in live response | ❌ (requires `DATA_GOV_IN_API_KEY`) |
| Groq tool-calling loop | ✅ (unit-tested with a stub provider and the real HTTP shape) |

Nothing in this table is presented to users as verified: `/api/provider-status`
and `/api/coverage` carry `configured`/`verification` levels explicitly.

## What agents may do with evidence

- Read the envelope only; they cannot request a new source.
- Call the four application-executed tools (`read_candles`, `read_indicator`,
  `search_evidence`, `read_evidence`), which read the same envelope. See
  [agents.md](agents.md).
- Cite only evidence ids present in the envelope; unknown ids fail the guard.

## Known limits

- Indian exchange announcement coverage depends on an operator-supplied BSE feed
  or an NSE licence; without either, Indian filings are `unavailable`.
- Free commercial tiers are delayed and rate-limited; they are treated as
  optional fallbacks, not coverage.
- NAV is end-of-day and only applies to funds/ETFs with an ISIN or AMFI code.
- No adapter produces candles from an LLM. If candle providers are absent,
  research requires user-supplied data or fails closed.
