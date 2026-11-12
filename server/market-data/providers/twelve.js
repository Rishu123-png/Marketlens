import { fetchJson } from "../http.js";
import { normalizeQuote } from "../normalize.js";
import { resolveProviderSymbol } from "../../../shared/instruments/catalog.js";

const SOURCE = "Twelve Data";

export const twelveProvider = {
  id: "twelve",
  label: SOURCE,

  isConfigured() {
    return Boolean(process.env.TWELVE_DATA_API_KEY);
  },

  supports(instrument) {
    return resolveProviderSymbol(instrument, "twelve") !== null;
  },

  async fetchQuote(instrument) {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) throw new Error("Twelve Data API key is not configured.");

    const symbol = resolveProviderSymbol(instrument, "twelve");
    if (!symbol) throw new Error("Twelve Data has no mapping for this instrument.");

    const data = await fetchJson(
      "https://api.twelvedata.com/quote" +
        `?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`
    );

    if (data?.code || data?.message || data?.status === "error") {
      throw new Error(data?.message || data?.code || "Twelve Data returned an error.");
    }

    // Twelve returns `close` (not `price`); validate the normalized value so a
    // renamed provider field cannot silently reject every quote.
    const quote = normalizeQuote({
      item: data,
      instrument,
      source: SOURCE,
      provider: "twelve"
    });

    if (quote.price === null) {
      throw new Error("Twelve Data returned no usable price.");
    }

    return quote;
  }
};
