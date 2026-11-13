/** Pure browser-local virtual order calculations; never sends an order anywhere. */
export const STARTING_CASH = 1_000_000;
export const FEE_RATE = 0.0005;
export const SLIPPAGE_RATE = 0.0005;

const symbolKey = (value) => String(value || "").replace(/^\^/, "").toUpperCase();

function instrumentProblem(instrument, currency) {
  if (!instrument?.symbol || !instrument.exchange) return "Choose an instrument with an exchange first.";
  if (!["NSE", "BSE"].includes(instrument.exchange) || currency !== "INR") {
    return "This virtual account supports INR NSE/BSE instruments only; currency conversion is not available.";
  }
  if (instrument.assetType && !["equity", "etf"].includes(instrument.assetType)) {
    return "Only equities and ETFs are supported in this simulation; indices and derivatives are unavailable.";
  }
  return null;
}

/** Market endpoint returns the quote itself, not a {quote: ...} wrapper. */
export function verifiedQuoteForInstrument(quote, instrument) {
  if (!quote || quote.mode !== "verified" || quote.quoteVerified !== true || !(Number(quote.price) > 0) || !Number.isFinite(Number(quote.price))) return false;
  if (symbolKey(quote.symbol) !== symbolKey(instrument?.symbol) || quote.exchange !== instrument?.exchange) return false;
  const id = instrument?.instrumentId || (String(instrument?.id || "").startsWith("pos-") ? null : instrument?.id);
  if (id && quote.instrumentId !== id) return false;
  return quote.currency === "INR" && ["equity", "etf"].includes(quote.assetType);
}

function commonProblem(instrument, side, quantity, currency) {
  const problem = instrumentProblem(instrument, currency);
  if (problem) return problem;
  if (!["BUY", "SELL"].includes(side)) return "Choose BUY or SELL.";
  if (!Number.isInteger(quantity) || quantity <= 0) return "Quantity must be a positive whole number.";
  return null;
}

export function simulateMarketOrder(account, { instrument, side, qty, quote, id, at }) {
  const quantity = Number(qty);
  if (!quote) return { ok: false, message: "No matching provider-verified quote is available. The simulated order was not filled." };
  const problem = commonProblem(instrument, side, quantity, quote.currency);
  if (problem) return { ok: false, message: problem };
  if (!verifiedQuoteForInstrument(quote, instrument)) {
    return { ok: false, message: "No matching provider-verified quote is available. The simulated order was not filled." };
  }
  const price = Number(quote.price);
  const fillPrice = Number((price * (side === "BUY" ? 1 + SLIPPAGE_RATE : 1 - SLIPPAGE_RATE)).toFixed(2));
  if (!(fillPrice > 0)) return { ok: false, message: "The simulated fill price is too small to represent to two decimal places." };
  const notional = fillPrice * quantity;
  const fees = Number((notional * FEE_RATE).toFixed(2));
  const position = account.positions.find((entry) => entry.symbol === instrument.symbol && entry.exchange === instrument.exchange);
  if (side === "BUY" && account.cash < notional + fees) return { ok: false, message: "Insufficient virtual cash for this fill." };
  if (side === "SELL" && (!position || position.qty < quantity)) return { ok: false, message: "Cannot sell more than the simulated position." };

  let positions;
  if (side === "BUY") {
    const nextPosition = position
      ? { ...position, qty: position.qty + quantity, avgCost: Number(((position.avgCost * position.qty + notional) / (position.qty + quantity)).toFixed(2)) }
      : { id: `${id}-position`, instrumentId: instrument.id || quote.instrumentId, symbol: instrument.symbol, name: instrument.name, exchange: instrument.exchange, currency: "INR", assetType: quote.assetType, qty: quantity, avgCost: fillPrice, openedAt: at };
    positions = position ? account.positions.map((entry) => entry.id === position.id ? nextPosition : entry) : [...account.positions, nextPosition];
  } else {
    positions = account.positions.map((entry) => entry.id === position.id ? { ...entry, qty: entry.qty - quantity } : entry).filter((entry) => entry.qty > 0);
  }
  const order = {
    id, at, side, type: "MARKET", symbol: instrument.symbol, name: instrument.name, exchange: instrument.exchange,
    currency: "INR", qty: quantity, fillPrice, fees,
    slippage: Number((Math.abs(fillPrice - price) * quantity).toFixed(2)), status: "FILLED",
    quoteSource: quote.source || quote.provider || null,
    quoteTimestamp: quote.providerTimestamp || null,
    quoteRetrievedAt: quote.retrievedAt || null,
    referencePrice: price
  };
  const cash = side === "BUY" ? account.cash - notional - fees : account.cash + notional - fees;
  return {
    ok: true,
    message: `Simulated ${side} filled at ${fillPrice}. No real order was placed.`,
    order,
    account: { ...account, cash: Number(cash.toFixed(2)), positions, orders: [order, ...account.orders].slice(0, 250) }
  };
}

export function simulateLimitOrder(account, { instrument, side, qty, limitPrice, currency, id, at }) {
  const quantity = Number(qty);
  const limit = Number(limitPrice);
  const problem = commonProblem(instrument, side, quantity, currency);
  if (problem) return { ok: false, message: problem };
  if (!Number.isFinite(limit) || !(limit > 0)) return { ok: false, message: "Enter a positive limit price." };
  const order = { id, at, side, type: "LIMIT", symbol: instrument.symbol, name: instrument.name, exchange: instrument.exchange, currency, qty: quantity, limitPrice: limit, fees: 0, status: "PENDING" };
  return { ok: true, message: "Simulated limit order recorded as PENDING. It never auto-fills or reaches a broker.", order, account: { ...account, orders: [order, ...account.orders].slice(0, 250) } };
}
