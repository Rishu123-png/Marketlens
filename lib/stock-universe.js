import { POPULAR_INDIAN_EQUITY_IDS, getInstrument } from "../shared/instruments/catalog.js";

/**
 * The curated list shown on the terminal's default view.
 *
 * Derived from shared/instruments/catalog.js so there is one instrument source
 * of truth. The shape here stays flat (symbol/exchange/name/sector) because the
 * table renders it directly; new code should use the catalog and instrument IDs.
 */
export const STOCK_UNIVERSE = POPULAR_INDIAN_EQUITY_IDS.map((id) => {
  const instrument = getInstrument(id);
  return {
    symbol: instrument.symbol,
    exchange: instrument.exchange,
    name: instrument.name,
    sector: instrument.sector
  };
});
