import { fetchJson } from "../http.js";
import { normalizeQuote } from "../normalize.js";
import { resolveProviderSymbol } from "../../../shared/instruments/catalog.js";

const SOURCE = "Alpha Vantage";

function symbolCandidates(instrument) {
  const mapped = resolveProviderSymbol(instrument, "alpha");
  if (!mapped) return [];
  const candidates = [mapped];
  if (instrument.country === "IN") candidates.push(`${instrument.symbol}.BSE`);
  return [...new Set(candidates)];
}

export const alphaProvider = {
  id: "alpha",
  label: SOURCE,

  isConfigured() {
    return Boolean(process.env.ALPHA_VANTAGE_API_KEY);
  },

  supports(instrument) {
    return resolveProviderSymbol(instrument, "alpha") !== null;
  },

  async fetchQuote(instrument) {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) throw new Error("Alpha Vantage API key is not configured.");

    const candidates = symbolCandidates(instrument);
    if (!candidates.length) throw new Error("Alpha Vantage has no mapping for this instrument.");

    let lastError = "Alpha Vantage returned no usable quote.";

    for (const symbol of candidates) {
      try {
        const data = await fetchJson(
          "https://www.alphavantage.co/query" +
            "?function=GLOBAL_QUOTE" +
            `&symbol=${encodeURIComponent(symbol)}` +
            `&apikey=${encodeURIComponent(apiKey)}`
        );

        if (data?.Note) throw new Error(data.Note);
        if (data?.Information) throw new Error(data.Information);
        if (data?.["Error Message"]) throw new Error(data["Error Message"]);

        const quote = data?.["Global Quote"];

        if (quote?.["05. price"] !== undefined && quote?.["05. price"] !== "") {
          return normalizeQuote({
            item: quote,
            instrument,
            source: SOURCE,
            provider: "alpha"
          });
        }

        lastError = "Alpha Vantage returned no quote.";
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Alpha Vantage failed.";
      }
    }

    throw new Error(lastError);
  }
};
