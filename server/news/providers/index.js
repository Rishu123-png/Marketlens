import { newsApiProvider } from "./newsapi.js";
import { gnewsProvider } from "./gnews.js";
import { rssProvider } from "./rss.js";

export const NEWS_PROVIDERS = [newsApiProvider, gnewsProvider, rssProvider];

/**
 * Provider order: explicit `NEWS_PROVIDER_ORDER` (comma separated ids) first,
 * then any remaining provider that is configured. Disabled providers are
 * skipped rather than failing the request.
 */
export function getNewsProviders(order = process.env.NEWS_PROVIDER_ORDER) {
  const requested = String(order || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const ordered = [];
  for (const id of requested) {
    const provider = NEWS_PROVIDERS.find((entry) => entry.id === id);
    if (provider && !ordered.includes(provider)) ordered.push(provider);
  }
  for (const provider of NEWS_PROVIDERS) {
    if (!ordered.includes(provider)) ordered.push(provider);
  }

  return ordered;
}

export function newsProviderStatus() {
  return NEWS_PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    configured: provider.isConfigured(),
    ...(provider.id === "official-rss"
      ? {
          activeFeeds: provider.configuredFeedCount(),
          unverifiedFeeds: provider.unverifiedCandidates()
        }
      : {})
  }));
}
