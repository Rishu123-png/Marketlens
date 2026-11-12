/**
 * Official feed configuration.
 *
 * Policy (see docs/architecture/evidence-sources.md):
 * - Only documented feeds from official publishers are enabled by default.
 * - Exchange websites that prohibit automated collection are *not* scraped. BSE
 *   publishes RSS feeds for announcements and filings, but the exact URLs are
 *   not part of a stable public contract, so they are supplied by the operator
 *   through `BSE_ANNOUNCEMENTS_RSS` rather than hard-coded.
 * - Nothing here is a promise that a URL resolves. `documented` says the
 *   publisher advertises the feed; `liveVerified` stays false until an operator
 *   confirms reachability, and the coverage endpoint reports that distinction.
 *
 * `NEWS_RSS_FEEDS` format: `Publisher|https://example.com/feed.xml` separated
 * by newlines or semicolons (operator-verified, always enabled).
 * `NEWS_RSS_ENABLED=off` disables all feed polling.
 */

export const OFFICIAL_FEEDS = [
  {
    id: "rbi-press-releases",
    publisher: "Reserve Bank of India",
    url: "https://www.rbi.org.in/pressreleases_rss.xml",
    sourceType: "regulatory",
    documented: true,
    liveVerified: false,
    enabledByDefault: true,
    termsUrl: "https://www.rbi.org.in/",
    note: "Official RBI press-release RSS."
  },
  {
    id: "rbi-notifications",
    publisher: "Reserve Bank of India",
    url: "https://www.rbi.org.in/notifications_rss.xml",
    sourceType: "regulatory",
    documented: true,
    liveVerified: false,
    enabledByDefault: true,
    termsUrl: "https://www.rbi.org.in/",
    note: "Official RBI notification RSS."
  },
  {
    id: "rbi-speeches",
    publisher: "Reserve Bank of India",
    url: "https://www.rbi.org.in/speeches_rss.xml",
    sourceType: "regulatory",
    documented: true,
    liveVerified: false,
    enabledByDefault: true,
    termsUrl: "https://www.rbi.org.in/",
    note: "Official RBI speeches RSS; useful for policy tone, not price data."
  },
  {
    id: "sebi-all",
    publisher: "Securities and Exchange Board of India",
    url: "https://www.sebi.gov.in/sebirss.xml",
    sourceType: "regulatory",
    documented: true,
    liveVerified: false,
    enabledByDefault: true,
    termsUrl: "https://www.sebi.gov.in/rss.html",
    note: "Official SEBI RSS: press releases, circulars, orders and rulings."
  },
  {
    id: "pib-economy",
    publisher: "Press Information Bureau",
    url: "https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1",
    sourceType: "announcement",
    documented: true,
    liveVerified: false,
    enabledByDefault: true,
    termsUrl: "https://pib.gov.in/",
    note: "Official PIB feed; feed ids vary by ministry, this is the general economy feed."
  },
  {
    id: "bse-announcements",
    publisher: "BSE Ltd",
    url: null,
    envKey: "BSE_ANNOUNCEMENTS_RSS",
    sourceType: "announcement",
    documented: true,
    liveVerified: false,
    enabledByDefault: false,
    termsUrl: "https://beta.bseindia.com/rss-feed.html",
    note:
      "BSE advertises RSS for corporate announcements, results, board meetings and insider trading. " +
      "The feed URL is operator-supplied; do not use BSE's internal JSON APIs."
  },
  {
    id: "nse-announcements-rss",
    publisher: "National Stock Exchange of India",
    url: null,
    envKey: "NSE_ANNOUNCEMENTS_RSS",
    sourceType: "announcement",
    documented: false,
    liveVerified: false,
    enabledByDefault: false,
    termsRisk: true,
    termsUrl: "https://www.nseindia.com/static/nse-terms-of-use",
    note:
      "NSE terms prohibit systematic automated collection without written consent. " +
      "Only enable this feed if NSE has granted permission in writing."
  }
];

/** Backwards-compatible name used by earlier releases. */
export const CANDIDATE_FEEDS = OFFICIAL_FEEDS;

function feedEnabled(feed, env) {
  if (feed.envKey && env[feed.envKey]) return true;
  return feed.enabledByDefault === true;
}

function feedUrl(feed, env) {
  if (feed.envKey && env[feed.envKey]) return String(env[feed.envKey]).trim();
  return feed.url;
}

export function rssPollingEnabled(env = process.env) {
  const flag = String(env.NEWS_RSS_ENABLED ?? "on").toLowerCase();
  return !["off", "false", "0", "disabled"].includes(flag);
}

export function parseFeedConfig(value = process.env.NEWS_RSS_FEEDS) {
  if (!value || typeof value !== "string") return [];

  return value
    .split(/[\n;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const [publisher, url] = entry.split("|").map((part) => part.trim());
      if (!publisher || !url) return null;
      return {
        id: `env-feed-${index + 1}`,
        publisher,
        url,
        sourceType: "news",
        documented: true,
        liveVerified: false,
        operatorConfigured: true,
        verified: true
      };
    })
    .filter(Boolean);
}

/**
 * Feeds that will actually be polled.
 * `verified` is kept for API compatibility and means "operator supplied"; it
 * never means the publisher has confirmed or that the endpoint was reachable.
 */
export function activeFeeds(env = process.env) {
  if (!rssPollingEnabled(env)) return [];

  const official = OFFICIAL_FEEDS.filter((feed) => feedEnabled(feed, env))
    .map((feed) => ({
      ...feed,
      url: feedUrl(feed, env),
      verified: true
    }))
    .filter((feed) => Boolean(feed.url));

  return [...official, ...parseFeedConfig(env.NEWS_RSS_FEEDS)];
}

/** Status of every known feed, including the ones that are deliberately off. */
export function feedStatus(env = process.env) {
  const polling = rssPollingEnabled(env);

  return OFFICIAL_FEEDS.map((feed) => {
    const enabled = polling && feedEnabled(feed, env);
    return {
      id: feed.id,
      publisher: feed.publisher,
      enabled,
      urlSource: feed.envKey ? `env:${feed.envKey}` : "built-in",
      documented: feed.documented === true,
      liveVerified: false,
      status: enabled
        ? "enabled-unverified-live"
        : feed.termsRisk
          ? "disabled-terms-risk"
          : feed.envKey
            ? `disabled-requires-${feed.envKey}`
            : "disabled",
      termsUrl: feed.termsUrl ?? null,
      note: feed.note ?? null
    };
  });
}
