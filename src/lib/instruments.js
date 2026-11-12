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
