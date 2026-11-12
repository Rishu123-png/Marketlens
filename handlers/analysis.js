// Chart Lab payload: candles + deterministic indicators + deterministic patterns.
// AI interpretation is deliberately absent from this endpoint.
import { getCandles } from "../server/market-data/candles.js";
import {
  INDICATOR_ENGINE_VERSION,
  bollingerBands,
  ema,
  indicatorSnapshot,
  macd,
  rsi,
  sma
} from "../server/indicators/index.js";
import { PATTERN_ENGINE_VERSION, analyzeChart } from "../server/patterns/index.js";
import { rateLimit } from "../lib/server/rateLimit.js";


function seriesOf(candles, values) {
  const rows = [];
  for (let index = 0; index < candles.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;
    rows.push({ time: candles[index].time, value: Number(value.toFixed(4)) });
  }
  return rows;
}

/** Full indicator series for chart overlays; every value is server-computed. */
function buildSeries(candles) {
  const closes = candles.map((candle) => candle.close);
  const bands = bollingerBands(closes, 20, 2);
  const macdSeries = macd(closes);

  let cumulativeValue = 0;
  let cumulativeVolume = 0;
  const vwap = candles.map((candle) => {
    const volume = Number.isFinite(candle.volume) ? candle.volume : 0;
    const typical = (candle.high + candle.low + candle.close) / 3;
    cumulativeValue += typical * volume;
    cumulativeVolume += volume;
    return cumulativeVolume > 0 ? cumulativeValue / cumulativeVolume : null;
  });

  return {
    sma20: seriesOf(candles, sma(closes, 20)),
    sma50: seriesOf(candles, sma(closes, 50)),
    sma200: seriesOf(candles, sma(closes, 200)),
    ema20: seriesOf(candles, ema(closes, 20)),
    bbUpper: seriesOf(candles, bands.upper),
    bbLower: seriesOf(candles, bands.lower),
    rsi14: seriesOf(candles, rsi(closes, 14)),
    macd: seriesOf(candles, macdSeries.macdLine),
    macdSignal: seriesOf(candles, macdSeries.signalLine),
    vwap: seriesOf(candles, vwap),
    note:
      "Series are aligned to candle timestamps; leading windows are omitted, never zero-filled. VWAP is anchored to the first candle in this window, not to a session open."
  };
}

export default async function handler(req, res) {
  const quota = await rateLimit(req, { name: "analysis", limit: 30, windowMs: 60_000 });
  if (!quota.allowed) {
    res.setHeader?.("Retry-After", String(quota.retryAfterSeconds));
    return res.status(429).json({
      error: "Too many analysis requests. Please try again shortly.",
      retryAfterSeconds: quota.retryAfterSeconds
    });
  }

  const symbol = String(req.query?.symbol || "").trim().toUpperCase();
  if (!/^\^?[A-Z0-9._:&-]{1,40}$/.test(symbol)) {
    return res.status(400).json({ error: "A valid symbol is required." });
  }

  try {
    const data = await getCandles(symbol, {
      exchange: String(req.query?.exchange || "").trim().toUpperCase(),
      interval: req.query?.interval || "1day",
      limit: req.query?.limit
    });

    return res.status(200).json({
      mode: "deterministic-analysis",
      instrumentId: data.instrumentId,
      symbol: data.symbol,
      exchange: data.exchange,
      interval: data.interval,
      source: data.source,
      candles: data.candles,
      indicators: indicatorSnapshot(data.candles),
      series: buildSeries(data.candles),
      chart: analyzeChart(data.candles),
      versions: {
        indicators: INDICATOR_ENGINE_VERSION,
        patterns: PATTERN_ENGINE_VERSION
      },
      coverage: data.coverage,
      droppedRows: data.droppedRows,
      retrievedAt: data.retrievedAt,
      limitations: [
        "Calculations are deterministic and historical; they do not forecast prices",
        "AI interpretation is a separate step and is not part of this response"
      ]
    });
  } catch (error) {
    return res.status(error.statusCode || 503).json({
      error: error.message || "Chart analysis is unavailable.",
      ...(error.details ? { details: error.details } : {})
    });
  }
}
