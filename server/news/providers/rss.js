import { fetchText } from "../http.js";
import { parseFeed } from "../rss.js";
import { activeFeeds, CANDIDATE_FEEDS } from "../feeds.js";

const SOURCE = "Official RSS";

function keywordsFor(query, instrument) {
  const raw = [query, instrument?.symbol?.replace(/^\^/, ""), instrument?.name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return [...new Set(raw.split(/[^a-z0-9]+/i).filter((word) => word.length >= 3))];
}

function matches(entry, keywords) {
  if (!keywords.length) return true;
  const haystack = `${entry.title} ${entry.excerpt || ""}`.toLowerCase();
  return keywords.some((word) => haystack.includes(word));
}

/**
 * Official-source feeds (RBI, SEBI, PIB and any publisher configured through
 * `NEWS_RSS_FEEDS`). No key required; only verified/config-provided feeds are
 * polled. Excerpts are capped by the sanitizer downstream.
 */
export const rssProvider = {
  id: "official-rss",
  label: SOURCE,
  sourceType: "regulatory",

  isConfigured() {
    return activeFeeds().length > 0;
  },

  configuredFeedCount() {
    return activeFeeds().length;
  },

  /** Exposed for the provider-status endpoint: candidates are not integrations. */
  unverifiedCandidates() {
    return CANDIDATE_FEEDS.filter((feed) => !feed.verified).map((feed) => ({
      id: feed.id,
      publisher: feed.publisher,
      status: "unverified-configuration"
    }));
  },

  async search({ query, instrument, limit = 10 }) {
    const feeds = activeFeeds();
    if (!feeds.length) throw new Error("No official feeds are configured.");

    const keywords = keywordsFor(query, instrument);
    const results = [];
    const failures = [];

    for (const feed of feeds) {
      try {
        const xml = await fetchText(feed.url, { timeoutMs: 8_000 });
        const entries = parseFeed(xml, { limit: 30 }).filter((entry) => matches(entry, keywords));

        for (const entry of entries) {
          results.push({
            title: entry.title,
            url: entry.url,
            publisher: feed.publisher,
            publishedAt: entry.publishedAt,
            excerpt: entry.excerpt,
            sourceType: feed.sourceType === "regulatory" ? "regulatory" : "announcement",
            verification: "verified",
            provider: "official-rss",
            language: "en"
          });
        }
      } catch (error) {
        failures.push({ feed: feed.id, message: error instanceof Error ? error.message : "feed failed" });
      }
    }

    if (!results.length && failures.length === feeds.length) {
      throw new Error(`All official feeds failed: ${failures.map((item) => `${item.feed} ${item.message}`).join("; ")}`);
    }

    return results
      .sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0))
      .slice(0, limit);
  }
};
