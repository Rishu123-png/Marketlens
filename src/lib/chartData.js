/**
 * Chart Lab data path.
 *
 * The chart's candle request is `/api/history`; `/api/analysis` adds server
 * indicator series and chart structure. Analysis is requested after history so
 * the server's candle cache is warm and a selection causes at most one provider
 * fetch. The functions are injectable so the request contract is testable
 * without a browser.
 */

import { api } from "./api.js";

export const CHART_LIMIT = 320;

export function chartPaths({ symbol, exchange = "", interval = "1day", limit = CHART_LIMIT }) {
  const common =
    `symbol=${encodeURIComponent(symbol)}` +
    `&exchange=${encodeURIComponent(exchange || "")}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&limit=${encodeURIComponent(String(limit))}`;

  return {
    history: `/api/history?${common}`,
    analysis: `/api/analysis?${common}`,
    quote: `/api/market?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange || "")}`
  };
}

export function chartRequestKey({ symbol, exchange = "", interval = "1day" }) {
  return `${symbol}|${exchange || "NSE"}|${interval}`;
}

/**
 * @returns {Promise<{analysis:object|null, quote:object|null, quoteError:string|null,
 *   analysisWarning:string|null, error:object|null, requests:string[]}>}
 */
export async function fetchChartData({
  symbol,
  exchange = "",
  interval = "1day",
  limit = CHART_LIMIT,
  signal,
  apiImpl = api
} = {}) {
  const paths = chartPaths({ symbol, exchange, interval, limit });
  const requests = [paths.history, paths.quote];

  const [historyResult, quoteResult] = await Promise.allSettled([
    apiImpl(paths.history, { signal }),
    apiImpl(paths.quote, { signal })
  ]);

  let analysisValue = null;
  try {
    requests.push(paths.analysis);
    analysisValue = await apiImpl(paths.analysis, { signal });
  } catch {
    analysisValue = null;
  }

  const history = historyResult.status === "fulfilled" ? historyResult.value : null;
  const quote = quoteResult.status === "fulfilled" ? quoteResult.value : null;
  const quoteError =
    quoteResult.status === "fulfilled"
      ? null
      : quoteResult.reason?.message || "No verified quote is available for this instrument.";

  let analysis = null;
  let error = null;
  let analysisWarning = null;

  if (history || analysisValue) {
    if (analysisValue) {
      analysis = {
        ...analysisValue,
        candles: history?.candles?.length ? history.candles : analysisValue.candles,
        coverage: history?.coverage || analysisValue.coverage,
        source: history?.source || analysisValue.source,
        retrievedAt: history?.retrievedAt || analysisValue.retrievedAt,
        cached: Boolean(history?.cached)
      };
    } else {
      analysis = {
        ...history,
        chart: null,
        indicators: null,
        series: null
      };
      analysisWarning =
        "Candles loaded, but indicator series and chart structure are unavailable for this timeframe.";
    }
  } else {
    error = {
      message:
        historyResult.reason?.message || "Historical candles are unavailable for this instrument and timeframe.",
      status: historyResult.reason?.status,
      details: historyResult.reason?.details
    };
  }

  return { analysis, quote, quoteError, analysisWarning, error, requests };
}
