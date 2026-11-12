import { fetchText } from "../http.js";
import { parseFeed } from "../rss.js";
import { activeFeeds, feedStatus } from "../feeds.js";
import { recordSourceOutcome } from "../../evidence/health.js";

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

  /** Exposed for the provider-status/coverage endpoints: documented ≠ reachable. */
  feedStatus() {
    return feedStatus();
  },

  async search({ query, instrument, limit = 10 }) {
    const feeds = activeFeeds();
    if (!feeds.length) throw new Error("No official feeds are configured.");

    const keywords = keywordsFor(query, instrument);
    const results = [];
    const failures = [];

    // Poll feeds concurrently: one slow publisher must not serialise the rest,
    // and each failure is reported instead of aborting the whole search.
    const settled = await Promise.allSettled(
      feeds.map(async (feed) => {
        const xml = await fetchText(feed.url, { timeoutMs: 5_000 });
        return { feed, entries: parseFeed(xml, { limit: 30 }).filter((entry) => matches(entry, keywords)) };
      })
    );

    for (const outcome of settled) {
      if (outcome.status === "rejected") {
        const feed = feeds[settled.indexOf(outcome)];
        const message = outcome.reason instanceof Error ? outcome.reason.message : "feed failed";
        recordSourceOutcome(feed?.id ?? "unknown-feed", { ok: false, error: message });
        failures.push({ feed: feed?.id ?? "unknown", message });
        continue;
      }

      const { feed, entries } = outcome.value;
      recordSourceOutcome(feed.id, { ok: true });
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
          language: "en",
          metadata: { feedId: feed.id, liveVerified: false, termsUrl: feed.termsUrl ?? null }
        });
      }
    }

    if (!results.length && failures.length === feeds.length) {
      recordSourceOutcome("official-rss", {
        ok: false,
        error: failures.map((item) => `${item.feed} ${item.message}`).join("; ")
      });
      throw new Error(`All official feeds failed: ${failures.map((item) => `${item.feed} ${item.message}`).join("; ")}`);
    }

    if (results.length) recordSourceOutcome("official-rss", { ok: true });

    return results
      .sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0))
      .slice(0, limit);
  }
};
