/**
 * Market Lens deterministic technical-indicator engine.
 *
 * Design rules (see docs/architecture/agents.md):
 * - An LLM never computes these values; agents only interpret them.
 * - Every function returns an array aligned index-for-index with its input.
 * - Positions without enough usable history are `null`, never `0`, so callers
 *   cannot mistake "unknown" for a reading.
 * - A non-finite / missing input resets the rolling window instead of silently
 *   bridging the gap.
 *
 * Conventions: RSI uses Wilder smoothing, Bollinger Bands use the population
 * standard deviation (ddof = 0), matching the defaults users compare against on
 * common charting platforms.
 */

export const INDICATOR_ENGINE_VERSION = "1.0.0";

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeSeries(values, label) {
  if (!Array.isArray(values)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return values.map((value) => toNumber(value));
}

function assertPeriod(period) {
  if (!Number.isInteger(period) || period < 1) {
    throw new RangeError("period must be a positive integer.");
  }
}

function assertCandles(candles) {
  if (!Array.isArray(candles)) {
    throw new TypeError("candles must be an array.");
  }
}

/** Sum over the trailing `period` entries, or null if any entry is missing. */
function rollingSum(series, period) {
  const out = new Array(series.length).fill(null);
  const window = [];
  let sum = 0;
  let missing = 0;

  for (let index = 0; index < series.length; index += 1) {
    const value = series[index];
    window.push(value);
    if (value === null) missing += 1;
    else sum += value;

    if (window.length > period) {
      const dropped = window.shift();
      if (dropped === null) missing -= 1;
      else sum -= dropped;
    }

    if (window.length === period && missing === 0) out[index] = sum;
  }

  return out;
}

/** Simple moving average. */
export function sma(values, period) {
  assertPeriod(period);
  const series = normalizeSeries(values, "values");
  return rollingSum(series, period).map((sum) => (sum === null ? null : sum / period));
}

/**
 * Exponential moving average.
 * Seeded with the SMA of the first `period` contiguous values, then smoothed
 * with k = 2 / (period + 1).
 */
export function ema(values, period) {
  assertPeriod(period);
  const series = normalizeSeries(values, "values");
  const out = new Array(series.length).fill(null);
  const k = 2 / (period + 1);

  let seed = 0;
  let run = 0;
  let current = null;

  for (let index = 0; index < series.length; index += 1) {
    const value = series[index];

    if (value === null) {
      seed = 0;
      run = 0;
      current = null;
      continue;
    }

    if (current === null) {
      seed += value;
      run += 1;
      if (run === period) {
        current = seed / period;
        out[index] = current;
      }
      continue;
    }

    current = value * k + current * (1 - k);
    out[index] = current;
  }

  return out;
}

function rsiFromAverages(avgGain, avgLoss) {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  if (avgGain === 0) return 0;
  const relativeStrength = avgGain / avgLoss;
  return 100 - 100 / (1 + relativeStrength);
}

/** Relative Strength Index with Wilder smoothing (default 14 periods). */
export function rsi(values, period = 14) {
  assertPeriod(period);
  const series = normalizeSeries(values, "values");
  const out = new Array(series.length).fill(null);

  let gainSum = 0;
  let lossSum = 0;
  let count = 0;
  let avgGain = null;
  let avgLoss = null;

  for (let index = 1; index < series.length; index += 1) {
    const previous = series[index - 1];
    const current = series[index];

    if (previous === null || current === null) {
      gainSum = 0;
      lossSum = 0;
      count = 0;
      avgGain = null;
      avgLoss = null;
      continue;
    }

    const change = current - previous;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    if (avgGain === null) {
      gainSum += gain;
      lossSum += loss;
      count += 1;
      if (count === period) {
        avgGain = gainSum / period;
        avgLoss = lossSum / period;
        out[index] = rsiFromAverages(avgGain, avgLoss);
      }
      continue;
    }

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[index] = rsiFromAverages(avgGain, avgLoss);
  }

  return out;
}

/** MACD line, signal line and histogram (default 12 / 26 / 9). */
export function macd(values, { fast = 12, slow = 26, signal = 9 } = {}) {
  assertPeriod(fast);
  assertPeriod(slow);
  assertPeriod(signal);
  if (slow <= fast) throw new RangeError("slow period must be greater than fast period.");

  const fastLine = ema(values, fast);
  const slowLine = ema(values, slow);

  const macdLine = fastLine.map((value, index) =>
    value === null || slowLine[index] === null ? null : value - slowLine[index]
  );
  const signalLine = ema(macdLine, signal);
  const histogram = macdLine.map((value, index) =>
    value === null || signalLine[index] === null ? null : value - signalLine[index]
  );

  return { macdLine, signalLine, histogram };
}

function trueRange(high, low, previousClose) {
  const ranges = [high - low];
  if (previousClose !== null) {
    ranges.push(Math.abs(high - previousClose), Math.abs(low - previousClose));
  }
  return Math.max(...ranges);
}

/** Average True Range with Wilder smoothing. */
export function atr(candles, period = 14) {
  assertPeriod(period);
  assertCandles(candles);

  const out = new Array(candles.length).fill(null);
  let sum = 0;
  let count = 0;
  let current = null;
  let previousClose = null;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index] || {};
    const high = toNumber(candle.high);
    const low = toNumber(candle.low);
    const close = toNumber(candle.close);

    if (high === null || low === null || close === null || high < low) {
      sum = 0;
      count = 0;
      current = null;
      previousClose = null;
      continue;
    }

    const range = trueRange(high, low, previousClose);
    previousClose = close;

    if (current === null) {
      sum += range;
      count += 1;
      if (count === period) {
        current = sum / period;
        out[index] = current;
      }
      continue;
    }

    current = (current * (period - 1) + range) / period;
    out[index] = current;
  }

  return out;
}

/** Bollinger Bands (population standard deviation). */
export function bollingerBands(values, period = 20, multiplier = 2) {
  assertPeriod(period);
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new RangeError("multiplier must be a positive number.");
  }

  const series = normalizeSeries(values, "values");
  const middle = sma(series, period);
  const upper = new Array(series.length).fill(null);
  const lower = new Array(series.length).fill(null);

  for (let index = period - 1; index < series.length; index += 1) {
    const mean = middle[index];
    if (mean === null) continue;

    let variance = 0;
    for (let offset = index - period + 1; offset <= index; offset += 1) {
      variance += (series[offset] - mean) ** 2;
    }
    const deviation = Math.sqrt(variance / period);

    upper[index] = mean + multiplier * deviation;
    lower[index] = mean - multiplier * deviation;
  }

  return { middle, upper, lower };
}

/**
 * Latest volume against the average of the preceding `baselinePeriod` sessions.
 * The current session is excluded from the baseline.
 */
export function relativeVolume(volumes, baselinePeriod = 20) {
  assertPeriod(baselinePeriod);
  const series = normalizeSeries(volumes, "volumes");
  const latest = series.length ? series[series.length - 1] : null;

  if (latest === null || series.length < baselinePeriod + 1) {
    return { latest, baseline: null, ratio: null };
  }

  const window = series.slice(-baselinePeriod - 1, -1);
  if (window.some((value) => value === null)) {
    return { latest, baseline: null, ratio: null };
  }

  const baseline = window.reduce((total, value) => total + value, 0) / window.length;
  if (!(baseline > 0)) return { latest, baseline, ratio: null };

  return { latest, baseline, ratio: latest / baseline };
}

/** Last non-null value of an aligned series, or null. */
export function latest(series) {
  if (!Array.isArray(series)) return null;
  for (let index = series.length - 1; index >= 0; index -= 1) {
    if (series[index] !== null && series[index] !== undefined) return series[index];
  }
  return null;
}

/**
 * Compact snapshot for the Technical agent: the latest reading of each
 * indicator, with `null` preserved where history was insufficient.
 */
export function indicatorSnapshot(candles, { rsiPeriod = 14, atrPeriod = 14, volumeBaseline = 20 } = {}) {
  assertCandles(candles);

  const closes = candles.map((candle) => toNumber(candle?.close));
  const volumes = candles.map((candle) => toNumber(candle?.volume));
  const movingAverages = {};

  for (const period of [20, 50, 100, 200]) {
    movingAverages[`sma${period}`] = latest(sma(closes, period));
  }
  for (const period of [9, 20, 50]) {
    movingAverages[`ema${period}`] = latest(ema(closes, period));
  }

  const macdSeries = macd(closes);
  const bands = bollingerBands(closes, 20, 2);
  const volume = relativeVolume(volumes, volumeBaseline);

  return {
    candles: candles.length,
    lastClose: latest(closes),
    movingAverages,
    rsi: latest(rsi(closes, rsiPeriod)),
    macd: {
      line: latest(macdSeries.macdLine),
      signal: latest(macdSeries.signalLine),
      histogram: latest(macdSeries.histogram)
    },
    atr: latest(atr(candles, atrPeriod)),
    bollinger: {
      middle: latest(bands.middle),
      upper: latest(bands.upper),
      lower: latest(bands.lower)
    },
    relativeVolume: volume.ratio,
    volumeBaseline: volume.baseline
  };
}
