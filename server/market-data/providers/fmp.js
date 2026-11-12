import { fetchJson } from "../http.js";
import { normalizeQuote } from "../normalize.js";
import { resolveProviderSymbol } from "../../../shared/instruments/catalog.js";

const SOURCE = "Financial Modeling Prep";

/**
 * FMP lists Indian equities with an exchange suffix (.NS / .BO). Try the mapped
 * ticker first, then the bare symbol for instruments quoted without a suffix.
 */
function symbolCandidates(instrument) {
  const mapped = resolveProviderSymbol(instrument, "fmp");
  if (!mapped) return [];
  if (instrument.assetType !== "equity" || instrument.country !== "IN") return [mapped];
  return [...new Set([mapped, instrument.symbol])];
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
