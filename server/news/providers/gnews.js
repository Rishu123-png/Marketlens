import { fetchJson } from "../http.js";

const SOURCE = "GNews";

/**
 * GNews search API (`/api/v4/search`). Requires `GNEWS_API_KEY`.
 * Free tiers are rate limited; the adapter surfaces the upstream message.
 */
export const gnewsProvider = {
  id: "gnews",
  label: SOURCE,
  sourceType: "news",

  isConfigured() {
    return Boolean(process.env.GNEWS_API_KEY);
  },

  async search({ query, instrument, limit = 10, sinceDays = 7 }) {
    const apiKey = process.env.GNEWS_API_KEY;
    if (!apiKey) throw new Error("GNews key is not configured.");

    const terms = query || [instrument?.name, instrument?.symbol].filter(Boolean).join(" ");
    const from = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);

    const data = await fetchJson(
      "https://gnews.io/api/v4/search" +
        `?q=${encodeURIComponent(terms)}` +
        `&lang=en&from=${from}&sortby=publishedAt` +
        `&max=${Math.min(Math.max(limit, 1), 50)}` +
        `&apikey=${encodeURIComponent(apiKey)}`
    );

    if (!Array.isArray(data?.articles)) throw new Error(data?.errors?.[0] || "GNews returned no articles.");

    return data.articles.map((article) => ({
      title: article.title,
      url: article.url,
      publisher: article.source?.name || SOURCE,
      publishedAt: article.publishedAt,
      excerpt: article.description || article.content,
      sourceType: "news",
      verification: "reported",
      provider: "gnews",
      language: "en"
    }));
  }
};
