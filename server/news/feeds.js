/**
 * Official-source feed configuration.
 *
 * The entries below are candidate endpoints for Indian official publishers.
 * They are configuration, not verified integrations: feed URLs and terms of use
 * change, so every entry is marked `verified: false` until someone confirms the
 * endpoint, the licence to redistribute excerpts and the update cadence. Only
 * explicit `NEWS_RSS_FEEDS` entries (or entries flipped to verified here) are
 * polled in production.
 *
 * `NEWS_RSS_FEEDS` format: `Publisher|https://example.com/feed.xml` separated
 * by newlines or semicolons.
 */

export const CANDIDATE_FEEDS = [
  {
    id: "rbi-press-releases",
    publisher: "Reserve Bank of India",
    url: "https://www.rbi.org.in/pressreleases_rss.xml",
    sourceType: "regulatory",
    verified: false
  },
  {
    id: "sebi-press",
    publisher: "Securities and Exchange Board of India",
    url: "https://www.sebi.gov.in/sebiweb/rss/pressRelease.xml",
    sourceType: "regulatory",
    verified: false
  },
  {
    id: "pib-economy",
    publisher: "Press Information Bureau",
    url: "https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1",
    sourceType: "announcement",
    verified: false
  }
];

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
        verified: true
      };
    })
    .filter(Boolean);
}

/** Verified feeds only: candidate entries need explicit confirmation first. */
export function activeFeeds() {
  return [...CANDIDATE_FEEDS.filter((feed) => feed.verified), ...parseFeedConfig()];
}
