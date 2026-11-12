import { fetchJson } from "../http.js";
import { normalizeCandle, normalizeQuote } from "../normalize.js";
import { resolveProviderSymbol } from "../../../shared/instruments/catalog.js";

const SOURCE = "Alpha Vantage";

/**
 * Alpha Vantage addresses Indian listings with an exchange suffix. Try the
 * instrument's own venue first, then the other Indian venue; never the bare
 * ticker, which resolves to a non-Indian listing.
 */
function symbolCandidates(instrument) {
  const mapped = resolveProviderSymbol(instrument, "alpha");
  if (!mapped) return [];
  if (instrument.country !== "IN") return [mapped];
  const other = instrument.exchange.includes("BSE") ? "NSE" : "BSE";
  return [...new Set([mapped, `${instrument.symbol}.${other}`])];
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
  },

  async fetchCandles(instrument, { interval = "1day", limit = 365 } = {}) {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) throw new Error("Alpha Vantage API key is not configured.");

    const series =
      interval === "1week" ? "TIME_SERIES_WEEKLY" : interval === "1day" ? "TIME_SERIES_DAILY" : null;
    if (!series) {
      throw new Error("Alpha Vantage only supports 1day and 1week candles here.");
    }

    const symbol = resolveProviderSymbol(instrument, "alpha");
    if (!symbol) throw new Error("Alpha Vantage has no mapping for this instrument.");

    const data = await fetchJson(
      "https://www.alphavantage.co/query" +
        `?function=${series}` +
        `&symbol=${encodeURIComponent(symbol)}` +
        `&outputsize=${limit > 100 ? "full" : "compact"}` +
        `&apikey=${encodeURIComponent(apiKey)}`,
      { timeoutMs: 12_000 }
    );

    if (data?.Note) throw new Error(data.Note);
    if (data?.Information) throw new Error(data.Information);
    if (data?.["Error Message"]) throw new Error(data["Error Message"]);

    const key = Object.keys(data || {}).find((entry) => entry.toLowerCase().includes("time series"));
    if (!key) throw new Error("Alpha Vantage returned no candles.");

    const candles = Object.entries(data[key])
      .map(([date, row]) =>
        normalizeCandle(
          {
            date,
            open: row["1. open"],
            high: row["2. high"],
            low: row["3. low"],
            close: row["4. close"],
            volume: row["5. volume"]
          },
          SOURCE
        )
      )
      .filter(Boolean)
      .reverse();

    return limit ? candles.slice(-limit) : candles;
  }
};
