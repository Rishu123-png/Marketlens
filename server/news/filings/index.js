import { fetchJson } from "../http.js";
import { secEdgarFilingsProvider } from "../../evidence/secEdgar.js";

/**
 * Official filings / announcements adapters.
 *
 * Status: adapter implemented, upstream access **unverified** and disabled by
 * default. Both Indian exchanges gate their announcement APIs behind browser
 * session cookies and terms that restrict automated redistribution. The
 * adapters fail closed until an operator supplies a session cookie via
 * server-side environment configuration, and every item they produce is marked
 * with `metadata.verificationStatus = "adapter-unverified"` until an operator
 * validates it against the exchange's own page.
 *
 * Do not enable these in production without checking exchange terms of use.
 * NSE's terms prohibit systematic automated collection without written consent,
 * so `NSE_FILINGS_COOKIE` exists for operators with a licence, not as a default.
 * The official SEC EDGAR adapter is registered alongside them for US listings.
 */

const NSE_ENDPOINT = "https://www.nseindia.com/api/corporate-announcements";

export const nseFilingsProvider = {
  id: "nse-announcements",
  label: "NSE corporate announcements",
  sourceType: "announcement",

  isConfigured() {
    return Boolean(process.env.NSE_FILINGS_COOKIE);
  },

  async search({ instrument, limit = 10 }) {
    if (!process.env.NSE_FILINGS_COOKIE) {
      throw new Error("NSE announcement access requires NSE_FILINGS_COOKIE (session cookie).");
    }
    if (instrument?.exchange !== "NSE") {
      throw new Error("NSE announcements only apply to NSE-listed instruments.");
    }

    const data = await fetchJson(
      `${NSE_ENDPOINT}?index=equities&symbol=${encodeURIComponent(instrument.symbol)}`,
      {
        headers: {
          cookie: process.env.NSE_FILINGS_COOKIE,
          referer: "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
          accept: "application/json"
        }
      }
    );

    if (!Array.isArray(data)) throw new Error("NSE returned an unexpected payload.");

    return data.slice(0, limit).map((row) => ({
      title: row.desc || row.subject || `${instrument.symbol} announcement`,
      url: row.attchmntFile || null,
      publisher: "National Stock Exchange of India",
      publishedAt: row.an_dt,
      excerpt: row.sm_name ? `Filed by ${row.sm_name}` : null,
      sourceType: "announcement",
      verification: "unverified",
      provider: "nse-announcements",
      language: "en",
      metadata: { verificationStatus: "adapter-unverified" }
    }));
  }
};

export const bseFilingsProvider = {
  id: "bse-announcements",
  label: "BSE corporate announcements",
  sourceType: "announcement",

  isConfigured() {
    return Boolean(process.env.BSE_FILINGS_ENABLED === "true");
  },

  async search() {
    throw new Error(
      "BSE announcements require a scrip-code mapping and BSE session credentials; " +
        "the adapter is intentionally not enabled."
    );
  }
};

export const FILING_PROVIDERS = [secEdgarFilingsProvider, nseFilingsProvider, bseFilingsProvider];

export function filingProviderStatus() {
  return FILING_PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    configured: provider.isConfigured(),
    ...(provider.id === "sec-edgar"
      ? { status: provider.isConfigured() ? "configured-official" : "disabled-requires-SEC_USER_AGENT" }
      : { status: provider.isConfigured() ? "configured-unverified" : "disabled-requires-credentials" }),
    ...(provider.id === "nse-announcements"
      ? { termsRisk: true, note: "NSE terms prohibit automated collection without written consent." }
      : {})
  }));
}
