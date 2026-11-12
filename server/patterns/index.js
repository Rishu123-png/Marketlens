/**
 * Deterministic chart-structure and pattern detection.
 *
 * Every pattern here is derived from candle geometry (pivots and fitted trend
 * lines). No model is involved, nothing is inferred from an image, and a pattern
 * is only reported when the number of candles is sufficient to support it.
 *
 * Confidence is a coarse geometric measure (how clean the fit is), not a
 * probability of future movement.
 */

export const PATTERN_ENGINE_VERSION = "1.0.0";

const MIN_CANDLES = 20;
const PIVOT_LEFT = 2;
const PIVOT_RIGHT = 2;

function finite(value) {
  return Number.isFinite(value);
}

function isCandle(candle) {
  return (
    candle &&
    [candle.open, candle.high, candle.low, candle.close].every(finite) &&
    candle.high >= candle.low
  );
}

function lastPrice(candles) {
  return candles[candles.length - 1].close;
}

function pctChange(from, to) {
  if (!finite(from) || from === 0) return 0;
  return (to - from) / Math.abs(from);
}

function round(value, digits = 4) {
  return Number(value.toFixed(digits));
}

/**
 * Local extrema over a symmetric window. Ties are resolved to the earliest
 * candle so the same series always produces the same pivots.
 */
export function findPivots(candles, { left = PIVOT_LEFT, right = PIVOT_RIGHT } = {}) {
  const highs = [];
  const lows = [];

  for (let index = left; index < candles.length - right; index += 1) {
    const candle = candles[index];
    let isHigh = true;
    let isLow = true;

    for (let offset = 1; offset <= left; offset += 1) {
      if (candles[index - offset].high >= candle.high) isHigh = false;
      if (candles[index - offset].low <= candle.low) isLow = false;
    }
    for (let offset = 1; offset <= right; offset += 1) {
      if (candles[index + offset].high >= candle.high) isHigh = false;
      if (candles[index + offset].low <= candle.low) isLow = false;
    }

    if (isHigh) highs.push({ index, price: candle.high, time: candle.time });
    if (isLow) lows.push({ index, price: candle.low, time: candle.time });
  }

  return { highs, lows };
}

/** Median of the first/last `window` closes, used when pivots are too sparse. */
function edgeMedian(candles, window = 5) {
  const size = Math.min(window, candles.length);
  const head = candles.slice(0, size).map((candle) => candle.close).sort((a, b) => a - b);
  const tail = candles.slice(-size).map((candle) => candle.close).sort((a, b) => a - b);
  const middle = (values) => values[Math.floor(values.length / 2)];
  return { from: middle(head), to: middle(tail) };
}

/**
 * Higher highs / higher lows → trend label. Requires at least two of each.
 *
 * A clean monotonic move produces no pivots at all, so an empty pivot set is a
 * property of the geometry rather than a lack of history. In that case the
 * trend falls back to the net change between the first and last candles and
 * says so explicitly.
 */
export function detectTrend(candles, pivots = findPivots(candles)) {
  const edges = edgeMedian(candles);
  const netChange = pctChange(edges.from, edges.to);

  if (candles.length < MIN_CANDLES) {
    return {
      label: "insufficient-history",
      method: "insufficient-history",
      higherHighs: 0,
      higherLows: 0,
      lowerHighs: 0,
      lowerLows: 0,
      evidence: [],
      detail: `need at least ${MIN_CANDLES} candles`,
      limitations: []
    };
  }

  if (pivots.highs.length < 2 || pivots.lows.length < 2) {
    const label = netChange > 0.01 ? "uptrend" : netChange < -0.01 ? "downtrend" : "sideways";
    return {
      label,
      method: "net-change-fallback",
      higherHighs: 0,
      higherLows: 0,
      lowerHighs: 0,
      lowerLows: 0,
      evidence: [],
      detail: `fewer than two pivot highs and lows; net change ${(netChange * 100).toFixed(2)}%`,
      limitations: [
        "Trend classification needs at least two pivot highs and two pivot lows; this label uses the net change instead"
      ]
    };
  }

  const highs = pivots.highs.slice(-4);
  const lows = pivots.lows.slice(-4);

  let higherHighs = 0;
  let lowerHighs = 0;
  for (let i = 1; i < highs.length; i += 1) {
    if (highs[i].price > highs[i - 1].price) higherHighs += 1;
    else if (highs[i].price < highs[i - 1].price) lowerHighs += 1;
  }

  let higherLows = 0;
  let lowerLows = 0;
  for (let i = 1; i < lows.length; i += 1) {
    if (lows[i].price > lows[i - 1].price) higherLows += 1;
    else if (lows[i].price < lows[i - 1].price) lowerLows += 1;
  }

  const slopeHighs = pctChange(highs[0].price, highs.at(-1).price);
  const slopeLows = pctChange(lows[0].price, lows.at(-1).price);

  let label = "sideways";
  if (slopeHighs > 0.01 && slopeLows > 0.01) label = "uptrend";
  else if (slopeHighs < -0.01 && slopeLows < -0.01) label = "downtrend";
  else if (higherHighs >= 2 && higherLows >= 2) label = "uptrend";
  else if (lowerHighs >= 2 && lowerLows >= 2) label = "downtrend";

  return {
    label,
    method: "pivot-structure",
    higherHighs,
    higherLows,
    lowerHighs,
    lowerLows,
    evidence: [...highs, ...lows].map((pivot) => pivot.index),
    detail: `HH ${higherHighs} · HL ${higherLows} · LH ${lowerHighs} · LL ${lowerLows}`,
    limitations: ["Pivot definition is window-based (2 candles either side); a different window can change the label"]
  };
}

/** Cluster repeated pivot prices into approximate support/resistance zones. */
export function detectSupportResistance(candles, pivots = findPivots(candles), { tolerancePct = 0.012, minTouches = 2 } = {}) {
  if (candles.length < MIN_CANDLES) return [];

  const price = lastPrice(candles);
  const tolerance = Math.abs(price) * tolerancePct;
  const points = [
    ...pivots.highs.map((pivot) => ({ ...pivot, kind: "high" })),
    ...pivots.lows.map((pivot) => ({ ...pivot, kind: "low" }))
  ].sort((a, b) => a.price - b.price);

  const clusters = [];
  for (const point of points) {
    const current = clusters.at(-1);
    if (current && Math.abs(point.price - current.mean) <= tolerance) {
      current.points.push(point);
      current.mean = current.points.reduce((total, item) => total + item.price, 0) / current.points.length;
    } else {
      clusters.push({ mean: point.price, points: [point] });
    }
  }

  return clusters
    .filter((cluster) => cluster.points.length >= minTouches)
    .map((cluster) => {
      const prices = cluster.points.map((point) => point.price);
      const low = Math.min(...prices);
      const high = Math.max(...prices);
      return {
        kind: cluster.mean >= price ? "resistance" : "support",
        low: round(low),
        high: round(high),
        touches: cluster.points.length,
        evidence: cluster.points.map((point) => point.index),
        method: "pivot-cluster-v1",
        limitations: ["Zones are historical reaction areas, not guaranteed future levels"]
      };
    })
    .sort((a, b) => b.touches - a.touches)
    .slice(0, 4);
}

function body(candle) {
  return Math.abs(candle.close - candle.open);
}

function range(candle) {
  return candle.high - candle.low;
}

function upperWick(candle) {
  return candle.high - Math.max(candle.open, candle.close);
}

function lowerWick(candle) {
  return Math.min(candle.open, candle.close) - candle.low;
}

/** Candlestick patterns on the most recent completed candles. */
export function detectCandlestickPatterns(candles) {
  if (candles.length < 5) return [];

  const patterns = [];
  const last = candles.at(-1);
  const previous = candles.at(-2);
  const lastRange = range(last);
  if (lastRange <= 0) return patterns;

  const lastBody = body(last);
  const lastUpper = upperWick(last);
  const lastLower = lowerWick(last);

  if (lastBody / lastRange <= 0.1) {
    patterns.push({ name: "doji", direction: "neutral", confidence: "medium", index: candles.length - 1, time: last.time });
  }

  if (lastLower >= lastBody * 2 && lastUpper <= lastBody && lastBody / lastRange < 0.4) {
    patterns.push({ name: "hammer", direction: "bullish", confidence: "medium", index: candles.length - 1, time: last.time });
  }

  if (lastUpper >= lastBody * 2 && lastLower <= lastBody && lastBody / lastRange < 0.4) {
    patterns.push({ name: "shooting-star", direction: "bearish", confidence: "medium", index: candles.length - 1, time: last.time });
  }

  const previousBearish = previous.close < previous.open;
  const previousBullish = previous.close > previous.open;
  const lastBullish = last.close > last.open;
  const lastBearish = last.close < last.open;

  if (
    previousBearish &&
    lastBullish &&
    last.close >= previous.open &&
    last.open <= previous.close
  ) {
    patterns.push({ name: "bullish-engulfing", direction: "bullish", confidence: "medium", index: candles.length - 1, time: last.time });
  }

  if (
    previousBullish &&
    lastBearish &&
    last.open >= previous.close &&
    last.close <= previous.open
  ) {
    patterns.push({ name: "bearish-engulfing", direction: "bearish", confidence: "medium", index: candles.length - 1, time: last.time });
  }

  return patterns.map((pattern) => ({
    ...pattern,
    method: "candle-geometry-v1",
    limitations: ["Single-candle patterns are weak evidence on their own"]
  }));
}

function linearFit(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.price ?? 0 };
  const sumX = points.reduce((total, point) => total + point.index, 0);
  const sumY = points.reduce((total, point) => total + point.price, 0);
  const sumXY = points.reduce((total, point) => total + point.index * point.price, 0);
  const sumXX = points.reduce((total, point) => total + point.index * point.index, 0);
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denominator;
  return { slope, intercept: (sumY - slope * sumX) / n };
}

function basePattern(name, kind, points, extra = {}) {
  return {
    name,
    kind,
    startTime: points[0]?.time ?? null,
    endTime: points.at(-1)?.time ?? null,
    evidence: points.map((point) => point.index),
    method: "pivot-geometry-v1",
    limitations: ["Detected from pivot geometry only; completion is not a prediction"],
    ...extra
  };
}

/** Double top / double bottom. */
function doubleTopBottom(pivots, candles) {
  const found = [];
  const highs = pivots.highs;
  const lows = pivots.lows;
  const price = lastPrice(candles);

  if (highs.length >= 2) {
    const [first, second] = highs.slice(-2);
    const difference = Math.abs(pctChange(first.price, second.price));
    const trough = lows.filter((low) => low.index > first.index && low.index < second.index).at(-1);

    if (difference <= 0.015 && trough) {
      const neckline = trough.price;
      const completed = price < neckline * 0.995;
      found.push(
        basePattern("double-top", "reversal", [first, second], {
          neckline: round(neckline),
          status: completed ? "completed" : "forming",
          confidence: difference <= 0.005 ? "medium" : "low",
          measuredMove: round(second.price + (second.price - neckline) * -1)
        })
      );
    }
  }

  if (lows.length >= 2) {
    const [first, second] = lows.slice(-2);
    const difference = Math.abs(pctChange(first.price, second.price));
    const peak = highs.filter((high) => high.index > first.index && high.index < second.index).at(-1);

    if (difference <= 0.015 && peak) {
      const neckline = peak.price;
      const completed = price > neckline * 1.005;
      found.push(
        basePattern("double-bottom", "reversal", [first, second], {
          neckline: round(neckline),
          status: completed ? "completed" : "forming",
          confidence: difference <= 0.005 ? "medium" : "low"
        })
      );
    }
  }

  return found;
}

/** Head and shoulders (and inverse). */
function headAndShoulders(pivots, candles) {
  const found = [];
  const price = lastPrice(candles);
  const highs = pivots.highs;
  const lows = pivots.lows;

  if (highs.length >= 3) {
    const [left, head, right] = highs.slice(-3);
    const headProminence = pctChange(left.price, head.price);
    const shoulderGap = Math.abs(pctChange(left.price, right.price));
    const necklinePoints = lows.filter((low) => low.index > left.index && low.index < right.index);

    if (headProminence > 0.02 && shoulderGap < 0.03 && necklinePoints.length >= 2) {
      const neckline = necklinePoints.reduce((total, low) => total + low.price, 0) / necklinePoints.length;
      found.push(
        basePattern("head-and-shoulders", "reversal", [left, head, right], {
          neckline: round(neckline),
          status: price < neckline * 0.995 ? "completed" : "forming",
          confidence: headProminence > 0.04 ? "medium" : "low"
        })
      );
    }
  }

  if (lows.length >= 3) {
    const [left, head, right] = lows.slice(-3);
    const headProminence = Math.abs(pctChange(left.price, head.price));
    const shoulderGap = Math.abs(pctChange(left.price, right.price));
    const necklinePoints = highs.filter((high) => high.index > left.index && high.index < right.index);

    if (headProminence > 0.02 && shoulderGap < 0.03 && necklinePoints.length >= 2) {
      const neckline = necklinePoints.reduce((total, high) => total + high.price, 0) / necklinePoints.length;
      found.push(
        basePattern("inverse-head-and-shoulders", "reversal", [left, head, right], {
          neckline: round(neckline),
          status: price > neckline * 1.005 ? "completed" : "forming",
          confidence: headProminence > 0.04 ? "medium" : "low"
        })
      );
    }
  }

  return found;
}

/** Triangles, wedges, channels and rectangles from fitted pivot lines. */
function channelPatterns(pivots) {
  const found = [];
  if (pivots.highs.length < 3 || pivots.lows.length < 3) return found;

  const highs = pivots.highs.slice(-3);
  const lows = pivots.lows.slice(-3);
  const resistance = linearFit(highs);
  const support = linearFit(lows);

  // Normalise slope by average price so comparisons are scale-free.
  const scale = Math.max(Math.abs(resistance.intercept), Math.abs(support.intercept), 1);
  const resistanceSlope = (resistance.slope / scale) * 100;
  const supportSlope = (support.slope / scale) * 100;
  const flat = 0.05;

  const points = highs.concat(lows).sort((a, b) => a.index - b.index);
  const found_spec = (name, kind) => basePattern(name, kind, points, { status: "forming", confidence: "low" });

  const risingResistance = resistanceSlope > flat;
  const fallingResistance = resistanceSlope < -flat;
  const risingSupport = supportSlope > flat;
  const fallingSupport = supportSlope < -flat;

  if (!risingResistance && !fallingResistance && risingSupport) {
    found.push(found_spec("ascending-triangle", "continuation"));
  } else if (!risingSupport && !fallingSupport && fallingResistance) {
    found.push(found_spec("descending-triangle", "continuation"));
  } else if (fallingResistance && risingSupport) {
    found.push(found_spec("symmetrical-triangle", "continuation"));
  } else if (risingResistance && risingSupport && resistanceSlope < supportSlope) {
    found.push(found_spec("rising-wedge", "reversal"));
  } else if (fallingResistance && fallingSupport && resistanceSlope > supportSlope) {
    found.push(found_spec("falling-wedge", "reversal"));
  } else if (!risingResistance && !fallingResistance && !risingSupport && !fallingSupport) {
    found.push(found_spec("rectangle", "consolidation"));
  } else if (Math.abs(resistanceSlope - supportSlope) <= flat) {
    found.push(found_spec(risingResistance ? "ascending-channel" : "descending-channel", "continuation"));
  }

  return found;
}

/** Flag: a short tight consolidation immediately after a sharp move. */
function flagPattern(candles) {
  if (candles.length < 25) return [];
  const window = candles.slice(-8);
  const prior = candles.slice(-18, -8);
  if (prior.length < 8) return [];

  const priorMove = pctChange(prior[0].close, prior.at(-1).close);
  const windowHigh = Math.max(...window.map((candle) => candle.high));
  const windowLow = Math.min(...window.map((candle) => candle.low));
  const consolidated = windowHigh > 0 ? (windowHigh - windowLow) / windowHigh : 1;

  if (Math.abs(priorMove) >= 0.04 && consolidated <= 0.03) {
    return [
      basePattern(
        priorMove > 0 ? "bull-flag" : "bear-flag",
        "continuation",
        [{ index: candles.length - 18, time: prior[0].time }, { index: candles.length - 1, time: window.at(-1).time }],
        { status: "forming", confidence: "low" }
      )
    ];
  }

  return [];
}

export function analyzeChart(candles, { minCandles = MIN_CANDLES } = {}) {
  const clean = Array.isArray(candles) ? candles.filter(isCandle) : [];

  if (clean.length < minCandles) {
    return {
      engineVersion: PATTERN_ENGINE_VERSION,
      candles: clean.length,
      trend: { label: "insufficient-history", detail: `need ${minCandles} candles`, evidence: [], limitations: [] },
      supportResistance: [],
      candlestickPatterns: [],
      chartPatterns: [],
      limitations: [`Chart analysis requires at least ${minCandles} valid candles; ${clean.length} were supplied.`]
    };
  }

  const pivots = findPivots(clean);
  const trend = detectTrend(clean, pivots);
  const supportResistance = detectSupportResistance(clean, pivots);

  const chartPatterns = [
    ...doubleTopBottom(pivots, clean),
    ...headAndShoulders(pivots, clean),
    ...channelPatterns(pivots),
    ...flagPattern(clean)
  ]
    .sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence))
    .slice(0, 6);

  return {
    engineVersion: PATTERN_ENGINE_VERSION,
    candles: clean.length,
    lastClose: lastPrice(clean),
    trend,
    supportResistance,
    // Recent pivot geometry is exposed so the chart can draw the same lines the
    // engine measured instead of recomputing them in the browser.
    pivots: {
      highs: pivots.highs.slice(-12),
      lows: pivots.lows.slice(-12)
    },
    candlestickPatterns: detectCandlestickPatterns(clean),
    chartPatterns,
    limitations: [
      "Pattern detection is geometric and deterministic; a detected pattern is not a prediction",
      "Zones and necklines are historical reference points, not guaranteed future levels"
    ]
  };
}

function confidenceRank(confidence) {
  return { low: 1, medium: 2, high: 3 }[confidence] || 0;
}
