/**
 * Deterministic market-structure detection.
 *
 * These are geometric hypotheses derived from actual OHLC candles — not
 * knowledge of institutional orders and not forecasts. Each signal carries the
 * rule that produced it, the candle indices/times it used, its invalidation
 * level and a coarse confidence. Order blocks and liquidity sweeps are named
 * "hypothesis" on purpose: the platform cannot see anyone's order book.
 */

import { findPivots, detectSupportResistance } from "./index.js";
import { atr } from "../indicators/index.js";

export const STRUCTURE_ENGINE_VERSION = "1.0.0";
const MIN_CANDLES = 30;
const DISPLACEMENT_ATR = 1.5;
const EQUAL_TOLERANCE = 0.0015;

function valid(candles) {
  return Array.isArray(candles)
    ? candles.filter(
        (candle) =>
          candle &&
          [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
          candle.high >= candle.low
      )
    : [];
}

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function lastAt(series) {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    if (Number.isFinite(series[index])) return series[index];
  }
  return null;
}

function confidenceFrom(strength) {
  if (strength >= 2.2) return "high";
  if (strength >= 1.6) return "medium";
  return "low";
}

/** Break of structure: latest close beyond the last confirmed swing. */
function detectBos(candles, pivots) {
  const close = candles.at(-1).close;
  const lastIndex = candles.length - 1;
  const signals = [];

  const swingHigh = [...pivots.highs].reverse().find((pivot) => pivot.index < lastIndex - 1);
  const swingLow = [...pivots.lows].reverse().find((pivot) => pivot.index < lastIndex - 1);

  if (swingHigh && close > swingHigh.price) {
    signals.push({
      type: "BOS",
      direction: "bullish",
      level: round(swingHigh.price),
      candle: lastIndex,
      pivot: swingHigh,
      rule: "Latest close is above the most recent confirmed swing high.",
      invalidation: `A close back below ${round(swingHigh.price)} weakens the breakout.`,
      confidence: close > swingHigh.price * 1.005 ? "medium" : "low"
    });
  }

  if (swingLow && close < swingLow.price) {
    signals.push({
      type: "BOS",
      direction: "bearish",
      level: round(swingLow.price),
      candle: lastIndex,
      pivot: swingLow,
      rule: "Latest close is below the most recent confirmed swing low.",
      invalidation: `A close back above ${round(swingLow.price)} weakens the breakdown.`,
      confidence: close < swingLow.price * 0.995 ? "medium" : "low"
    });
  }

  return signals;
}

/** Change of character: a counter-trend break after a directional swing set. */
function detectChoch(candles, pivots) {
  const close = candles.at(-1).close;
  const lastIndex = candles.length - 1;
  const highs = pivots.highs.slice(-2);
  const lows = pivots.lows.slice(-2);
  if (highs.length < 2 || lows.length < 2) return [];

  const rising = highs[1].price > highs[0].price && lows[1].price > lows[0].price;
  const falling = highs[1].price < highs[0].price && lows[1].price < lows[0].price;
  const signals = [];

  if (rising && close < lows[1].price) {
    signals.push({
      type: "CHoCH",
      direction: "bearish",
      level: round(lows[1].price),
      candle: lastIndex,
      rule: "Higher-high/higher-low sequence, then a close below the most recent higher low.",
      invalidation: "A new close above the most recent swing high restores the prior uptrend structure.",
      confidence: "medium"
    });
  }

  if (falling && close > highs[1].price) {
    signals.push({
      type: "CHoCH",
      direction: "bullish",
      level: round(highs[1].price),
      candle: lastIndex,
      rule: "Lower-high/lower-low sequence, then a close above the most recent lower high.",
      invalidation: "A new close below the most recent swing low restores the prior downtrend structure.",
      confidence: "medium"
    });
  }

  return signals;
}

/**
 * Order-block hypotheses: the last opposite candle before a displacement leg of
 * at least 1.5×ATR. Zone validity is checked against later closes/touches.
 */
function detectOrderBlocks(candles, atrValue) {
  if (!Number.isFinite(atrValue) || atrValue <= 0) return [];
  const blocks = [];

  for (let index = 1; index < candles.length - 1; index += 1) {
    const prior = candles[index - 1];
    const current = candles[index];
    const displacement = Math.abs(current.close - prior.close);
    if (displacement < DISPLACEMENT_ATR * atrValue) continue;

    const bullish = current.close > prior.close && prior.close < prior.open;
    const bearish = current.close < prior.close && prior.close > prior.open;
    if (!bullish && !bearish) continue;

    const zone = {
      low: round(prior.low),
      high: round(prior.high),
      direction: bullish ? "bullish" : "bearish",
      originIndex: index - 1,
      originTime: prior.time,
      displacementCandle: index,
      displacementAtr: Number((displacement / atrValue).toFixed(2))
    };

    let touched = false;
    let invalidated = false;
    for (let later = index; later < candles.length; later += 1) {
      const candle = candles[later];
      if (bullish) {
        if (candle.low <= zone.high && candle.high >= zone.low) touched = true;
        if (candle.close < zone.low) invalidated = true;
      } else {
        if (candle.high >= zone.low && candle.low <= zone.high) touched = true;
        if (candle.close > zone.high) invalidated = true;
      }
    }

    blocks.push({
      type: "order-block-hypothesis",
      direction: zone.direction,
      low: zone.low,
      high: zone.high,
      originTime: zone.originTime,
      displacementAtr: zone.displacementAtr,
      status: invalidated ? "invalidated" : touched ? "tested" : "fresh",
      invalidation:
        zone.direction === "bullish" ? `Close below ${zone.low}` : `Close above ${zone.high}`,
      confidence: invalidated ? "low" : confidenceFrom(zone.displacementAtr),
      rule: "Last opposite candle before a displacement leg of at least 1.5×ATR(14)."
    });
  }

  return blocks.slice(-6);
}

/** Three-candle fair value gaps, with fill state from later candles. */
function detectFairValueGaps(candles) {
  const gaps = [];

  for (let index = 2; index < candles.length; index += 1) {
    const first = candles[index - 2];
    const third = candles[index];

    if (third.low > first.high) {
      const gap = { low: first.high, high: third.low, direction: "bullish", index };
      let filled = false;
      for (let later = index + 1; later < candles.length; later += 1) {
        if (candles[later].low <= gap.low) filled = true;
      }
      gaps.push({
        type: "fair-value-gap",
        direction: gap.direction,
        low: round(gap.low),
        high: round(gap.high),
        time: third.time,
        status: filled ? "filled" : "open",
        invalidation: `A close below ${round(gap.low)} fully negates the bullish imbalance.`,
        confidence: filled ? "low" : "medium",
        rule: "Third candle's low is above the first candle's high (bullish imbalance)."
      });
    }

    if (third.high < first.low) {
      const gap = { low: third.high, high: first.low, direction: "bearish", index };
      let filled = false;
      for (let later = index + 1; later < candles.length; later += 1) {
        if (candles[later].high >= gap.high) filled = true;
      }
      gaps.push({
        type: "fair-value-gap",
        direction: gap.direction,
        low: round(gap.low),
        high: round(gap.high),
        time: third.time,
        status: filled ? "filled" : "open",
        invalidation: `A close above ${round(gap.high)} fully negates the bearish imbalance.`,
        confidence: filled ? "low" : "medium",
        rule: "Third candle's high is below the first candle's low (bearish imbalance)."
      });
    }
  }

  return gaps.slice(-6);
}

/** Pivot high/low pairs within a tight tolerance. */
function detectEqualLevels(pivots, candles) {
  const price = candles.at(-1).close;
  const tolerance = Math.abs(price) * EQUAL_TOLERANCE;
  const levels = [];

  for (const [kind, pivotSet] of [
    ["equal-highs", pivots.highs],
    ["equal-lows", pivots.lows]
  ]) {
    const recent = pivotSet.slice(-8);
    for (let a = 0; a < recent.length; a += 1) {
      for (let b = a + 1; b < recent.length; b += 1) {
        if (Math.abs(recent[a].price - recent[b].price) > tolerance) continue;
        levels.push({
          type: kind,
          level: round((recent[a].price + recent[b].price) / 2),
          touches: [recent[a].time, recent[b].time].filter(Boolean),
          tolerance: round(tolerance),
          status: "reference",
          confidence: "low",
          rule: `Two pivot ${kind === "equal-highs" ? "highs" : "lows"} within ${round(tolerance)} of each other.`,
          invalidation:
            "Equality is a liquidity reference, not a guarantee; a decisive close through the level invalidates it."
        });
      }
    }
  }

  return levels.slice(-4);
}

/** Wick beyond a prior swing that closes back inside it. */
function detectLiquiditySweeps(candles, pivots) {
  if (!candles.length) return [];
  const last = candles.at(-1);
  const priorHigh = [...pivots.highs].reverse().find((pivot) => pivot.index < candles.length - 1);
  const priorLow = [...pivots.lows].reverse().find((pivot) => pivot.index < candles.length - 1);
  const sweeps = [];

  if (priorHigh && last.high > priorHigh.price && last.close < priorHigh.price) {
    sweeps.push({
      type: "liquidity-sweep-hypothesis",
      direction: "bearish",
      level: round(priorHigh.price),
      time: last.time,
      status: "hypothesis",
      rule: "Latest high traded above the prior swing high but closed back below it.",
      invalidation: "A close above the swept high converts the sweep into a breakout.",
      confidence: "low"
    });
  }

  if (priorLow && last.low < priorLow.price && last.close > priorLow.price) {
    sweeps.push({
      type: "liquidity-sweep-hypothesis",
      direction: "bullish",
      level: round(priorLow.price),
      time: last.time,
      status: "hypothesis",
      rule: "Latest low traded below the prior swing low but closed back above it.",
      invalidation: "A close below the swept low converts the sweep into a breakdown.",
      confidence: "low"
    });
  }

  return sweeps;
}

export function analyzeMarketStructure(candles, { interval = "1day" } = {}) {
  const clean = valid(candles);
  const rules = [
    "BOS: latest close beyond the most recent confirmed swing high/low.",
    "CHoCH: counter-trend close through the most recent higher low / lower high.",
    "Order blocks: last opposite candle before a ≥1.5×ATR(14) displacement leg; a hypothesis, not observed institutional orders.",
    "FVG: three-candle imbalance where candle 1 and candle 3 do not overlap.",
    "Equal highs/lows: pivot pairs within 0.15% of price.",
    "Liquidity sweep: wick beyond a prior swing with a close back inside it."
  ];

  if (clean.length < MIN_CANDLES) {
    return {
      engineVersion: STRUCTURE_ENGINE_VERSION,
      interval,
      candles: clean.length,
      signals: [],
      supportResistance: [],
      rules,
      limitations: [`Market structure requires at least ${MIN_CANDLES} valid candles; ${clean.length} were supplied.`]
    };
  }

  const pivots = findPivots(clean);
  const atrSeries = atr(clean, 14);
  const atrValue = lastAt(atrSeries);
  const supportResistance = detectSupportResistance(clean, pivots);

  const signals = [
    ...detectBos(clean, pivots),
    ...detectChoch(clean, pivots),
    ...detectOrderBlocks(clean, atrValue),
    ...detectFairValueGaps(clean),
    ...detectEqualLevels(pivots, clean),
    ...detectLiquiditySweeps(clean, pivots)
  ];

  return {
    engineVersion: STRUCTURE_ENGINE_VERSION,
    interval,
    candles: clean.length,
    lastClose: round(clean.at(-1).close),
    atr: round(atrValue),
    signals,
    supportResistance,
    rules,
    limitations: [
      "Signals are deterministic geometric hypotheses, not knowledge of actual institutional orders.",
      "A signal is not a forecast or a guarantee of future price movement.",
      "Only the supplied candles and timeframe are analysed; no higher-timeframe context is inferred."
    ]
  };
}
