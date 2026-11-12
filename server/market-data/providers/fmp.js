import { fetchJson } from "../http.js";
import { recordProviderFailure } from "../providerPolicy.js";
import { normalizeCandle, normalizeQuote } from "../normalize.js";
import { resolveProviderSymbol } from "../../../shared/instruments/catalog.js";

const SOURCE = "Financial Modeling Prep";

/**
 * FMP stable API (the v3 endpoints were retired for accounts created after
 * 2025-08-31). Indian listings use the `.NS` / `.BO` suffix.
 *
 * The bare ticker is deliberately NOT tried as a fallback: `TCS` on FMP is The
 * Container Store (NYSE, USD), so falling back to it would produce a plausible
 * but wrong price for Tata Consultancy Services.
 */
function symbolCandidates(instrument) {
  const mapped = resolveProviderSymbol(instrument, "fmp");
  return mapped ? [mapped] : [];
}

const INTRADAY = Object.freeze({
  "1min": { endpoint: "1min", days: 10 },
  "5min": { endpoint: "5min", days: 30 },
  "15min": { endpoint: "15min", days: 60 },
  "30min": { endpoint: "30min", days: 90 },
  "1h": { endpoint: "1hour", days: 180 }
});

function isoDate(daysAgo) {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

function errorFromPayload(data) {
  const message = data?.["Error Message"] || data?.message || data?.error;
  if (!message) return null;
  const error = new Error(String(message).slice(0, 250));
  if (Number.isFinite(Number(data?.status))) error.status = Number(data.status);
  const text = String(message).toLowerCase();
  if (!error.status && /rate limit|per day|daily|quota|credits/.test(text)) {
    error.status = 429;
    error.kind = "rate-limited";
  }
  if (!error.status && /premium|exclusive endpoint|not entitled|subscription|upgrade/.test(text)) {
    error.status = 403;
    error.kind = "permission";
  }
  return error;
}

async function failPayload(error) {
  if (error?.status) await recordProviderFailure("fmp", error);
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

  supportsCandleInterval(interval) {
    return interval === "1day" || Object.hasOwn(INTRADAY, interval);
  },

  async fetchQuote(instrument) {
    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) throw new Error("FMP API key is not configured.");

    const candidates = symbolCandidates(instrument);
    if (!candidates.length) throw new Error("FMP has no mapping for this instrument.");

    let lastError = "FMP returned no quote.";

    for (const symbol of candidates) {
      const data = await fetchJson(
        "https://financialmodelingprep.com/stable/quote" +
          `?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`,
        { timeoutMs: 9_000, providerId: "fmp" }
      );

      const payloadError = errorFromPayload(data);
      if (payloadError) {
        await failPayload(payloadError);
        throw payloadError;
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        lastError = "FMP returned no quote.";
        continue;
      }
      if (row.price === null || row.price === undefined) {
        lastError = "FMP returned no usable price.";
        continue;
      }

      return normalizeQuote({
        item: row,
        instrument,
        source: SOURCE,
        provider: "fmp"
      });
    }

    throw new Error(lastError);
  },

  async fetchCandles(instrument, { interval = "1day", limit = 365 } = {}) {
    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) throw new Error("FMP API key is not configured.");

    const symbol = resolveProviderSymbol(instrument, "fmp");
    if (!symbol) throw new Error("FMP has no mapping for this instrument.");

    const wantsDaily = interval === "1day";
    const intraday = INTRADAY[interval];
    if (!wantsDaily && !intraday) {
      throw new Error("FMP does not support this interval.");
    }

    const days = wantsDaily ? Math.min(5000, Math.max(30, Math.ceil(limit * 1.7) + 7)) : intraday.days;
    const base = wantsDaily
      ? "https://financialmodelingprep.com/stable/historical-price-eod/full"
      : `https://financialmodelingprep.com/stable/historical-chart/${intraday.endpoint}`;
    const data = await fetchJson(
      `${base}?symbol=${encodeURIComponent(symbol)}` +
        `&from=${isoDate(days)}&to=${isoDate(0)}&apikey=${encodeURIComponent(apiKey)}`,
      { timeoutMs: 12_000, providerId: "fmp" }
    );

    const payloadError = errorFromPayload(data);
    if (payloadError) {
      await failPayload(payloadError);
      throw payloadError;
    }
    if (!Array.isArray(data)) throw new Error("FMP returned no candles.");

    return data
      .map((row) =>
        normalizeCandle(
          {
            date: row.date,
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
            volume: row.volume
          },
          SOURCE
        )
      )
      .filter(Boolean)
      .sort((a, b) => String(a.time).localeCompare(String(b.time)))
      .slice(-limit);
  }
};
