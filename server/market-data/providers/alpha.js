import { fetchJson } from "../http.js";
import { recordProviderFailure } from "../providerPolicy.js";
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

function payloadError(data) {
  const message = data?.Note || data?.Information || data?.["Error Message"];
  if (!message) return null;
  const error = new Error(String(message).slice(0, 250));
  const text = String(message).toLowerCase();
  if (/rate limit|frequency|per day|daily|quota|credits/.test(text)) {
    error.status = 429;
    error.kind = "rate-limited";
  } else if (/premium|not entitled|subscription/.test(text)) {
    error.status = 403;
    error.kind = "permission";
  }
  return error;
}

async function recordPayloadFailure(error) {
  if (!error?.status) return;
  await recordProviderFailure("alpha", error);
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

  /** Alpha's free endpoints used here only provide daily/weekly series. */
  supportsCandleInterval(interval) {
    return interval === "1day" || interval === "1week";
  },

  async fetchQuote(instrument) {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) throw new Error("Alpha Vantage API key is not configured.");

    const candidates = symbolCandidates(instrument);
    if (!candidates.length) throw new Error("Alpha Vantage has no mapping for this instrument.");

    let lastError = null;

    for (const symbol of candidates) {
      try {
        const data = await fetchJson(
          "https://www.alphavantage.co/query" +
            "?function=GLOBAL_QUOTE" +
            `&symbol=${encodeURIComponent(symbol)}` +
            `&apikey=${encodeURIComponent(apiKey)}`,
          { providerId: "alpha" }
        );

        const failure = payloadError(data);
        if (failure) {
          await recordPayloadFailure(failure);
          throw failure;
        }

        const quote = data?.["Global Quote"];

        if (quote?.["05. price"] !== undefined && quote?.["05. price"] !== "") {
          return normalizeQuote({
            item: quote,
            instrument,
            source: SOURCE,
            provider: "alpha"
          });
        }

        lastError = new Error("Alpha Vantage returned no quote.");
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Alpha Vantage failed.");
        // A quota/permission failure applies to every candidate; stop before
        // burning a second request on the other exchange suffix.
        if ([403, 429].includes(Number(error?.status))) break;
      }
    }

    throw lastError ?? new Error("Alpha Vantage returned no usable quote.");
  },

  async fetchCandles(instrument, { interval = "1day", limit = 365 } = {}) {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) throw new Error("Alpha Vantage API key is not configured.");

    const series =
      interval === "1week" ? "TIME_SERIES_WEEKLY" : interval === "1day" ? "TIME_SERIES_DAILY" : null;
    if (!series) {
      throw new Error("Alpha Vantage only supports 1day and 1week candles here.");
    }

    const candidates = symbolCandidates(instrument);
    if (!candidates.length) throw new Error("Alpha Vantage has no mapping for this instrument.");

    let lastError = null;
    for (const symbol of candidates) {
      try {
        const data = await fetchJson(
          "https://www.alphavantage.co/query" +
            `?function=${series}` +
            `&symbol=${encodeURIComponent(symbol)}` +
            `&outputsize=${limit > 100 ? "full" : "compact"}` +
            `&apikey=${encodeURIComponent(apiKey)}`,
          { timeoutMs: 12_000, providerId: "alpha" }
        );

        const failure = payloadError(data);
        if (failure) {
          await recordPayloadFailure(failure);
          throw failure;
        }

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

        if (!candles.length) throw new Error("Alpha Vantage returned no usable candles.");
        return limit ? candles.slice(-limit) : candles;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Alpha Vantage failed.");
        if ([403, 429].includes(Number(error?.status))) break;
      }
    }

    throw lastError ?? new Error("Alpha Vantage returned no candles.");
  }
};
