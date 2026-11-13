export const ASSET_LABELS = {
  equity: "Equity",
  index: "Index",
  etf: "ETF",
  mutualfund: "Fund",
  future: "Future",
  option: "Option"
};

export function availabilityLabel(instrument) {
  const availability = instrument?.availability;
  if (!availability) return { tone: "muted", label: "unknown" };
  if (availability.quoteVerifiedRecently) return { tone: "ok", label: "verified quote" };
  if (availability.quoteEnabled) return { tone: "warn", label: "quote-capable, unverified" };
  return { tone: "bad", label: "no configured quote" };
}

export function instrumentKey(instrument) {
  return instrument?.id || `${instrument?.symbol}:${instrument?.exchange}`;
}

// Catalogued starting instruments by venue. This is identity only, never a price.
export function defaultInstrument(exchange = "NSE") {
  const defaults = {
    NSE: { id: "IN-EQ-TCS", symbol: "TCS", name: "Tata Consultancy Services Ltd", exchange: "NSE", currency: "INR", assetType: "equity" },
    BSE: { id: "IN-EQ-TCS-BSE", symbol: "TCS", name: "Tata Consultancy Services Ltd", exchange: "BSE", currency: "INR", assetType: "equity" },
    NASDAQ: { id: "US-EQ-AAPL", symbol: "AAPL", name: "Apple Inc", exchange: "NASDAQ", currency: "USD", assetType: "equity" },
    NYSE: { id: "US-EQ-JPM", symbol: "JPM", name: "JPMorgan Chase & Co", exchange: "NYSE", currency: "USD", assetType: "equity" }
  };
  return { ...(defaults[exchange] || defaults.NSE) };
}
