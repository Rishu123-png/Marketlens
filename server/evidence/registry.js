/**
 * Source registry: one place describing every external source the platform can
 * use, what it can and cannot provide, and what it requires.
 *
 * This is deliberately data, not behaviour. Adapters read it for status, the
 * coverage endpoint exposes it, and the provider-status endpoint keeps its
 * existing shape while gaining this view. Adding a permitted source should mean
 * adding an entry and an adapter — not editing the agents.
 */

import { OFFICIAL_FEEDS, rssPollingEnabled } from "../news/feeds.js";

const KEYED_MARKET_SOURCES = [
  {
    id: "fmp",
    label: "Financial Modeling Prep",
    capability: "quotes",
    envKey: "FMP_API_KEY",
    optional: true,
    official: false,
    interface: "HTTP JSON (commercial, free tier)",
    notes: "Free tier is rate-limited and delayed; no exchange licence is implied.",
    termsUrl: "https://site.financialmodelingprep.com/terms-of-service"
  },
  {
    id: "twelve",
    label: "Twelve Data",
    capability: "candles",
    envKey: "TWELVE_DATA_API_KEY",
    optional: true,
    official: false,
    interface: "HTTP JSON (commercial, free tier)",
    notes: "Free tier is rate-limited; intraday history is limited.",
    termsUrl: "https://twelvedata.com/terms"
  },
  {
    id: "alpha",
    label: "Alpha Vantage",
    capability: "candles",
    envKey: "ALPHA_VANTAGE_API_KEY",
    optional: true,
    official: false,
    interface: "HTTP JSON (commercial, free tier)",
    notes: "Free tier is heavily rate-limited (requests per day).",
    termsUrl: "https://www.alphavantage.co/terms_of_service/"
  }
];

const KEYED_NEWS_SOURCES = [
  {
    id: "newsapi",
    label: "NewsAPI.org",
    capability: "news",
    envKey: "NEWS_API_KEY",
    optional: true,
    official: false,
    interface: "HTTP JSON (commercial, free tier)",
    notes: "Free developer tier restricts commercial use and delayed articles.",
    termsUrl: "https://newsapi.org/terms"
  },
  {
    id: "gnews",
    label: "GNews",
    capability: "news",
    envKey: "GNEWS_API_KEY",
    optional: true,
    official: false,
    interface: "HTTP JSON (commercial, free tier)",
    notes: "Free tier caps daily requests.",
    termsUrl: "https://gnews.io/terms"
  }
];

export const OFFICIAL_SOURCES = [
  {
    id: "amfi-nav",
    label: "AMFI official NAV file",
    capability: "nav",
    official: true,
    interface: "Pipe-delimited text file",
    url: "https://www.amfiindia.com/spages/NAVAll.txt",
    requires: null,
    status: "available",
    delayed: true,
    termsUrl: "https://www.amfiindia.com/",
    notes: "End-of-day NAV for Indian schemes and ETFs. Not a live price or candle."
  },
  {
    id: "sec-edgar",
    label: "SEC EDGAR",
    capability: "filings",
    official: true,
    interface: "data.sec.gov JSON",
    url: "https://data.sec.gov/submissions/CIK##########.json",
    requires: "SEC_USER_AGENT",
    status: "requires-configuration",
    delayed: false,
    termsUrl: "https://www.sec.gov/os/accessing-edgar-data",
    notes: "Official US filings and XBRL facts; 10 requests/s, mandatory User-Agent with contact email, cache responses."
  },
  {
    id: "data-gov-in",
    label: "data.gov.in (OGD)",
    capability: "macro",
    official: true,
    interface: "HTTP JSON",
    url: "https://api.data.gov.in/resource/{resource_id}",
    requires: "DATA_GOV_IN_API_KEY",
    status: "requires-configuration",
    delayed: true,
    termsUrl: "https://data.gov.in/",
    notes: "Macro/reference datasets only; per-dataset licence and low free limits. No OHLCV series."
  },
  {
    id: "nse-website",
    label: "NSE website / internal APIs",
    capability: "filings",
    official: false,
    prohibited: true,
    interface: "HTML / undocumented JSON",
    requires: null,
    status: "prohibited",
    termsUrl: "https://www.nseindia.com/static/nse-terms-of-use",
    notes: "NSE terms prohibit systematic automated collection without written consent. Not implemented; do not add a scraper."
  }
];

export const OFFICIAL_FEED_SOURCES = OFFICIAL_FEEDS.map((feed) => ({
  kind: "feed",
  id: feed.id,
  label: `${feed.publisher} RSS`,
  capability: feed.envKey ? "filings" : "news",
  official: true,
  interface: "RSS",
  url: feed.envKey ? `env:${feed.envKey}` : feed.url,
  requires: feed.envKey ?? null,
  status: feed.termsRisk
    ? "prohibited-without-permission"
    : feed.envKey
      ? "requires-configuration"
      : "available",
  delayed: false,
  termsUrl: feed.termsUrl,
  notes: feed.note
}));

export const ALL_SOURCES = [
  ...OFFICIAL_FEED_SOURCES,
  ...OFFICIAL_SOURCES,
  ...KEYED_MARKET_SOURCES,
  ...KEYED_NEWS_SOURCES
];

function requiresOf(source) {
  return source.requires ?? source.envKey ?? null;
}

function configured(source, env) {
  if (source.prohibited) return false;
  const requirement = requiresOf(source);
  if (!requirement) return true;
  return Boolean(env[requirement]);
}

/** Per-source status for one environment. */
export function sourceStatuses(env = process.env) {
  const feedsPolling = rssPollingEnabled(env);

  return ALL_SOURCES.map((source) => {
    const isConfigured = configured(source, env);
    const isFeed = source.kind === "feed";

    let status;
    if (source.prohibited) status = "prohibited";
    else if (isFeed && !feedsPolling) status = "disabled";
    else if (!isConfigured) status = "unavailable";
    else if (source.official) status = "available";
    else status = "degraded";

    return {
      id: source.id,
      kind: source.kind ?? null,
      label: source.label,
      capability: source.capability,
      official: source.official === true,
      optional: source.optional === true,
      configured: isConfigured,
      status,
      verification: source.prohibited
        ? "prohibited"
        : !isConfigured
          ? "requires-configuration"
          : source.official
            ? "documented-official"
            : "configured-third-party-unverified",
      interface: source.interface,
      requires: requiresOf(source),
      delayed: source.delayed === true,
      termsUrl: source.termsUrl ?? null,
      notes: source.notes ?? null
    };
  });
}
