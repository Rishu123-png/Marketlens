import { fetchJson } from "../http.js";
import { normalizeQuote } from "../normalize.js";
import { resolveProviderSymbol } from "../../../shared/instruments/catalog.js";

const SOURCE = "Financial Modeling Prep";

/**
 * FMP lists Indian equities with an exchange suffix (.NS / .BO).
 *
 * The bare ticker is deliberately NOT tried as a fallback: `TCS` on FMP is The
 * Container Store (NYSE, USD), so falling back to it produced a plausible but
 * completely wrong price for Tata Consultancy Services. A missing NSE/BSE
 * listing is a provider limitation, not a reason to quote another company.
 */
function symbolCandidates(instrument) {
  const mapped = resolveProviderSymbol(instrument, "fmp");
  return mapped ? [mapped] : [];
}

export const fmpProvider = {
  id: "fmp",
  label: SOURCE,

  isConfigured() {
    return Boolean(process.env.FMP_API_KEY);
  },

  supports(instrument) {
    return resolveProviderSymbol(instrument, "fmp") !== null;
  },

  async fetchQuote(instrument) {
    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) throw new Error("FMP API key is not configured.");

    const candidates = symbolCandidates(instrument);
    if (!candidates.length) throw new Error("FMP has no mapping for this instrument.");

    let lastError = "FMP returned no quote.";

    for (const symbol of candidates) {
      const url =
        "https://financialmodelingprep.com/api/v3/quote/" +
        `${encodeURIComponent(symbol)}?apikey=${encodeURIComponent(apiKey)}`;

      const data = await fetchJson(url, { timeoutMs: 9_000 });

      if (!Array.isArray(data) || !data[0]) {
        lastError = "FMP returned no quote.";
        continue;
      }

      if (data[0].price === null || data[0].price === undefined) {
        lastError = "FMP returned no usable price.";
        continue;
      }

      return normalizeQuote({
        item: data[0],
        instrument,
        source: SOURCE,
        provider: "fmp"
      });
    }

    throw new Error(lastError);
  }
};
