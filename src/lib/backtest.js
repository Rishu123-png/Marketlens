/**
 * Small deterministic, long-only historical simulation. No network calls or
 * generated candles: callers provide the provider's validated OHLC series.
 * Signals are evaluated on a close and executed at the next candle's open.
 */
function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveInteger(value, name, min) {
  const number = finite(value);
  if (!Number.isInteger(number) || number < min) throw new Error(`${name} must be a whole number of at least ${min}.`);
  return number;
}

function validateCandles(candles) {
  if (!Array.isArray(candles) || candles.length < 2) throw new Error("At least two historical candles are required.");
  if (candles.some((row) => !row?.time || !(finite(row.open) > 0) || !(finite(row.close) > 0))) {
    throw new Error("The historical series contains a missing or invalid open/close; no test was run.");
  }
}

export function computeSignals(candles, params) {
  validateCandles(candles);
  const closes = candles.map((row) => Number(row.close));
  let fast, slow, lookback, entry, exit;
  let rsiMap = new Map();
  if (params.strategy === "sma") {
    fast = positiveInteger(params.fast, "Fast SMA", 2);
    slow = positiveInteger(params.slow, "Slow SMA", 3);
    if (fast >= slow) throw new Error("Fast SMA must be shorter than slow SMA.");
    if (slow >= candles.length) throw new Error("More candles are needed for the slow SMA and a next-open execution.");
  } else if (params.strategy === "rsi") {
    entry = finite(params.rsiEntry);
    exit = finite(params.rsiExit);
    if (entry === null || exit === null || entry < 0 || exit > 100 || entry >= exit) {
      throw new Error("RSI entry must be below RSI exit, with both between 0 and 100.");
    }
    rsiMap = new Map((params.rsiSeries || [])
      .filter((point) => point?.time != null && finite(point.value) !== null && Number(point.value) >= 0 && Number(point.value) <= 100)
      .map((point) => [String(point.time), Number(point.value)]));
    if (!candles.slice(0, -1).some((row) => rsiMap.has(String(row.time)))) {
      throw new Error("No aligned RSI series was returned; the RSI strategy is unavailable for this history.");
    }
  } else if (params.strategy === "breakout") {
    lookback = positiveInteger(params.lookback, "Lookback", 2);
    if (lookback >= candles.length - 1) throw new Error("More candles are needed for the breakout lookback and a next-open execution.");
  } else {
    throw new Error("Choose a supported strategy.");
  }

  const targets = [];
  let position = 0;
  for (let i = 0; i < candles.length; i += 1) {
    if (params.strategy === "sma" && i + 1 >= slow) {
      const fastMean = closes.slice(i + 1 - fast, i + 1).reduce((a, b) => a + b, 0) / fast;
      const slowMean = closes.slice(i + 1 - slow, i + 1).reduce((a, b) => a + b, 0) / slow;
      position = fastMean > slowMean ? 1 : 0;
    } else if (params.strategy === "rsi") {
      const rsi = rsiMap.get(String(candles[i].time));
      if (rsi !== undefined) {
        if (position === 0 && rsi <= entry) position = 1;
        else if (position === 1 && rsi >= exit) position = 0;
      }
    } else if (params.strategy === "breakout" && i >= lookback) {
      const prior = closes.slice(i - lookback, i);
      if (position === 0 && closes[i] > Math.max(...prior)) position = 1;
      else if (position === 1 && closes[i] < Math.min(...prior)) position = 0;
    }
    targets.push(position);
  }
  return targets;
}

export function backtest(candles, targets, { startingCapital, feeRate, slippageRate }) {
  validateCandles(candles);
  if (!Array.isArray(targets) || targets.length !== candles.length || targets.some((v) => v !== 0 && v !== 1)) {
    throw new Error("A valid signal is required for each candle.");
  }
  const capital = finite(startingCapital);
  const fee = finite(feeRate);
  const slippage = finite(slippageRate);
  if (!(capital > 0) || fee === null || fee < 0 || fee >= 1 || slippage === null || slippage < 0 || slippage >= 1) {
    throw new Error("Capital must be positive; fee and slippage must each be between 0% and 100% (exclusive).");
  }

  let cash = capital;
  let shares = 0;
  let entryCost = 0;
  let entryAt = null;
  let heldCandles = 0;
  const trades = [];
  const equity = [];
  const benchmark = [];
  const benchmarkUnits = capital / Number(candles[0].open);

  function closePosition(fillPrice, time) {
    const proceeds = shares * fillPrice * (1 - fee);
    cash = proceeds;
    trades.push({ entryAt, exitAt: time, entryCost, proceeds, pnl: proceeds - entryCost, returnPercent: ((proceeds - entryCost) / entryCost) * 100 });
    shares = 0;
    entryCost = 0;
    entryAt = null;
  }

  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];
    const open = Number(candle.open);
    const close = Number(candle.close);
    const target = i > 0 ? targets[i - 1] : 0;
    if (target === 1 && shares === 0) {
      const fill = open * (1 + slippage);
      entryCost = cash;
      shares = cash / (fill * (1 + fee));
      entryAt = candle.time;
      cash = 0;
    } else if (target === 0 && shares > 0) {
      closePosition(open * (1 - slippage), candle.time);
    }
    if (shares > 0) heldCandles += 1;
    // Close any remaining position at the last close, including both costs.
    // The final curve point, trade log and headline return use the same value.
    if (i === candles.length - 1 && shares > 0) closePosition(close * (1 - slippage), candle.time);
    equity.push({ time: candle.time, value: cash + shares * close });
    benchmark.push({ time: candle.time, value: benchmarkUnits * close });
  }

  const finalEquity = equity.at(-1).value;
  let runningPeak = capital;
  let maxDrawdown = 0;
  for (const point of equity) {
    runningPeak = Math.max(runningPeak, point.value);
    maxDrawdown = Math.min(maxDrawdown, ((point.value - runningPeak) / runningPeak) * 100);
  }
  const wins = trades.filter((trade) => trade.pnl > 0).length;
  return {
    trades, equity, benchmark, finalEquity,
    totalReturn: ((finalEquity - capital) / capital) * 100,
    benchmarkReturn: ((benchmark.at(-1).value - capital) / capital) * 100,
    maxDrawdown,
    winRate: trades.length ? (wins / trades.length) * 100 : null,
    exposure: (heldCandles / candles.length) * 100
  };
}
