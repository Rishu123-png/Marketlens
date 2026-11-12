import { getInstrument, POPULAR_INDIAN_EQUITY_IDS } from "../shared/instruments/catalog.js";

// Legacy curated list. Prefer GET /api/instruments, which exposes the full
// catalog with stable IDs, country/currency and asset types.
const STOCKS = POPULAR_INDIAN_EQUITY_IDS.map((id) => {
  const instrument = getInstrument(id);
  return {
    id: instrument.id,
    symbol: instrument.symbol,
    exchange: instrument.exchange,
    name: instrument.name,
    sector: instrument.sector
  };
});

export default function handler(_req, res) {
  return res.status(200).json({
    name: "Popular NSE stocks",
    scope: "A curated list of 20 actively followed Indian large-cap stocks, not the complete NSE/BSE listing.",
    stocks: STOCKS,
    count: STOCKS.length
  });
}
