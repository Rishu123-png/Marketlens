import { fetchJson } from "../http.js";

const SOURCE = "NewsAPI";

/**
 * NewsAPI.org general news search (`/v2/everything`).
 * Requires `NEWS_API_KEY`. Results are reported, not verified, claims.
 */
export const newsApiProvider = {
  id: "newsapi",
  label: SOURCE,
  sourceType: "news",

  isConfigured() {
    return Boolean(process.env.NEWS_API_KEY);
  },

  async search({ query, instrument, limit = 10, sinceDays = 7 }) {
    const apiKey = process.env.NEWS_API_KEY;
    if (!apiKey) throw new Error("NewsAPI key is not configured.");

    const terms = query || [instrument?.name, instrument?.symbol].filter(Boolean).join(" OR ");
    const from = new Date(Date.now() - sinceDays * 86_400_000).toISOString();

    const data = await fetchJson(
      "https://newsapi.org/v2/everything" +
        `?q=${encodeURIComponent(terms)}` +
        `&language=en&sortBy=publishedAt&from=${encodeURIComponent(from)}` +
        `&pageSize=${Math.min(Math.max(limit, 1), 50)}`,
      { headers: { "x-api-key": apiKey } }
    );

    if (data?.status === "error") throw new Error(data.message || "NewsAPI returned an error.");

    return (data?.articles || []).map((article) => ({
      title: article.title,
      url: article.url,
      publisher: article.source?.name || SOURCE,
      publishedAt: article.publishedAt,
      excerpt: article.description || article.content,
      sourceType: "news",
      verification: "reported",
      provider: "newsapi",
      language: "en"
    }));
  }
};
