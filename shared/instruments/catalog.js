/**
 * Instrument catalog — the single source of truth for instrument identity.
 *
 * Never identify an instrument by symbol alone: symbols are reused across
 * exchanges and providers. Every instrument carries a stable internal ID
 * (`IN-EQ-RELIANCE`), its exchange, country and currency, and optional
 * provider-specific tickers.
 *
 * Provider tickers are only declared where they are known. `resolveProviderSymbol`
 * can derive an equity ticker from the exchange suffix convention, but it never
 * guesses for indices or ETFs — an unmapped index/ETF is reported as unsupported
 * for that provider rather than being sent a fabricated symbol.
 */

const ASSET_CODE = { equity: "EQ", index: "IDX", etf: "ETF" };

const RAW_INSTRUMENTS = [
  // ---------------------------------------------------------------- India, equities
  // Order matters: this block is also the legacy "popular NSE" list consumed by
  // lib/stock-universe.js and GET /api/universe.
  { id: "IN-EQ-RELIANCE", symbol: "RELIANCE", name: "Reliance Industries Ltd", exchange: "NSE", sector: "Energy" },
  { id: "IN-EQ-TCS", symbol: "TCS", name: "Tata Consultancy Services Ltd", exchange: "NSE", sector: "Information Technology" },
  { id: "IN-EQ-INFY", symbol: "INFY", name: "Infosys Ltd", exchange: "NSE", sector: "Information Technology" },
  { id: "IN-EQ-HDFCBANK", symbol: "HDFCBANK", name: "HDFC Bank Ltd", exchange: "NSE", sector: "Banking" },
  { id: "IN-EQ-ICICIBANK", symbol: "ICICIBANK", name: "ICICI Bank Ltd", exchange: "NSE", sector: "Banking" },
  { id: "IN-EQ-SBIN", symbol: "SBIN", name: "State Bank of India", exchange: "NSE", sector: "Banking" },
  { id: "IN-EQ-BHARTIARTL", symbol: "BHARTIARTL", name: "Bharti Airtel Ltd", exchange: "NSE", sector: "Telecom" },
  { id: "IN-EQ-ITC", symbol: "ITC", name: "ITC Ltd", exchange: "NSE", sector: "Consumer Goods" },
  { id: "IN-EQ-LT", symbol: "LT", name: "Larsen & Toubro Ltd", exchange: "NSE", sector: "Industrials" },
  { id: "IN-EQ-HINDUNILVR", symbol: "HINDUNILVR", name: "Hindustan Unilever Ltd", exchange: "NSE", sector: "Consumer Goods" },
  { id: "IN-EQ-MARUTI", symbol: "MARUTI", name: "Maruti Suzuki India Ltd", exchange: "NSE", sector: "Automotive" },
  { id: "IN-EQ-SUNPHARMA", symbol: "SUNPHARMA", name: "Sun Pharmaceutical Industries Ltd", exchange: "NSE", sector: "Healthcare" },
  { id: "IN-EQ-TITAN", symbol: "TITAN", name: "Titan Company Ltd", exchange: "NSE", sector: "Consumer Goods" },
  { id: "IN-EQ-AXISBANK", symbol: "AXISBANK", name: "Axis Bank Ltd", exchange: "NSE", sector: "Banking" },
  { id: "IN-EQ-BAJFINANCE", symbol: "BAJFINANCE", name: "Bajaj Finance Ltd", exchange: "NSE", sector: "Financial Services" },
  { id: "IN-EQ-KOTAKBANK", symbol: "KOTAKBANK", name: "Kotak Mahindra Bank Ltd", exchange: "NSE", sector: "Banking" },
  { id: "IN-EQ-MM", symbol: "M&M", name: "Mahindra & Mahindra Ltd", exchange: "NSE", sector: "Automotive" },
  { id: "IN-EQ-ADANIENT", symbol: "ADANIENT", name: "Adani Enterprises Ltd", exchange: "NSE", sector: "Industrials" },
  { id: "IN-EQ-NTPC", symbol: "NTPC", name: "NTPC Ltd", exchange: "NSE", sector: "Utilities" },
  { id: "IN-EQ-POWERGRID", symbol: "POWERGRID", name: "Power Grid Corporation of India Ltd", exchange: "NSE", sector: "Utilities" },

  // ---------------------------------------------------------------- United States, equities
  {
    id: "US-EQ-AAPL",
    symbol: "AAPL",
    name: "Apple Inc",
    exchange: "NASDAQ",
    sector: "Information Technology"
  },
  {
    id: "US-EQ-MSFT",
    symbol: "MSFT",
    name: "Microsoft Corp",
    exchange: "NASDAQ",
    sector: "Information Technology"
  },
  {
    id: "US-EQ-NVDA",
    symbol: "NVDA",
    name: "NVIDIA Corp",
    exchange: "NASDAQ",
    sector: "Semiconductors"
  },
  {
    id: "US-EQ-GOOGL",
    symbol: "GOOGL",
    name: "Alphabet Inc",
    exchange: "NASDAQ",
    sector: "Communication Services"
  },
  {
    id: "US-EQ-AMZN",
    symbol: "AMZN",
    name: "Amazon.com Inc",
    exchange: "NASDAQ",
    sector: "Consumer Discretionary"
  },
  {
    id: "US-EQ-TSLA",
    symbol: "TSLA",
    name: "Tesla Inc",
    exchange: "NASDAQ",
    sector: "Automotive"
  },
  {
    id: "US-EQ-META",
    symbol: "META",
    name: "Meta Platforms Inc",
    exchange: "NASDAQ",
    sector: "Communication Services"
  },
  {
    id: "US-EQ-JPM",
    symbol: "JPM",
    name: "JPMorgan Chase & Co",
    exchange: "NYSE",
    sector: "Banking"
  },

  // ---------------------------------------------------------------- Indices
  {
    id: "IN-IDX-NIFTY50",
    symbol: "^NSEI",
    name: "Nifty 50",
    exchange: "NSE",
    assetType: "index",
    sector: "Broad Market",
    providers: { fmp: "^NSEI" }
  },
  {
    id: "IN-IDX-SENSEX",
    symbol: "^BSESN",
    name: "BSE Sensex",
    exchange: "BSE",
    assetType: "index",
    sector: "Broad Market",
    providers: { fmp: "^BSESN" }
  },
  {
    id: "US-IDX-SP500",
    symbol: "^GSPC",
    name: "S&P 500",
    exchange: "INDEX",
    assetType: "index",
    sector: "Broad Market",
    providers: { fmp: "^GSPC", twelve: "SPX" }
  },
  {
    id: "US-IDX-NASDAQ",
    symbol: "^IXIC",
    name: "NASDAQ Composite",
    exchange: "INDEX",
    assetType: "index",
    sector: "Broad Market",
    providers: { fmp: "^IXIC", twelve: "IXIC" }
  },
  {
    id: "US-IDX-DOW",
    symbol: "^DJI",
    name: "Dow Jones Industrial Average",
    exchange: "INDEX",
    assetType: "index",
    sector: "Broad Market",
    providers: { fmp: "^DJI", twelve: "DJI" }
  },

  // ---------------------------------------------------------------- ETFs
  {
    id: "IN-ETF-NIFTYBEES",
    symbol: "NIFTYBEES",
    name: "Nippon India Nifty 50 BeES",
    exchange: "NSE",
    assetType: "etf",
    sector: "Broad Market"
  },
  {
    id: "US-ETF-SPY",
    symbol: "SPY",
    name: "SPDR S&P 500 ETF Trust",
    exchange: "NYSE",
    assetType: "etf",
    sector: "Broad Market"
  },
  {
    id: "US-ETF-QQQ",
    symbol: "QQQ",
    name: "Invesco QQQ Trust",
    exchange: "NASDAQ",
    assetType: "etf",
    sector: "Broad Market"
  }
];

function normalizeInstrument(raw) {
  const assetType = raw.assetType || "equity";
  const country = raw.country || (raw.exchange === "NSE" || raw.exchange === "BSE" ? "IN" : "US");
  const currency = raw.currency || (country === "IN" ? "INR" : "USD");
  const id = raw.id || `${country}-${ASSET_CODE[assetType]}-${raw.symbol.replace(/^\^/, "").replace(/[^A-Z0-9]/gi, "").toUpperCase()}`;

  return Object.freeze({
    id,
    symbol: raw.symbol,
    name: raw.name,
    exchange: raw.exchange,
    country,
    currency,
    assetType,
    sector: raw.sector || "Unclassified",
    providers: raw.providers ? Object.freeze({ ...raw.providers }) : null
  });
}

export const INSTRUMENTS = Object.freeze(RAW_INSTRUMENTS.map(normalizeInstrument));

const BY_ID = new Map(INSTRUMENTS.map((instrument) => [instrument.id, instrument]));

/** Legacy "popular NSE" list, in catalog order. */
export const POPULAR_INDIAN_EQUITY_IDS = Object.freeze(
  INSTRUMENTS.filter((instrument) => instrument.country === "IN" && instrument.assetType === "equity").map(
    (instrument) => instrument.id
  )
);

export function getInstrument(id) {
  return BY_ID.get(String(id || "").trim().toUpperCase()) || null;
}

export function findInstrumentBySymbol(symbol, exchange = "") {
  const needle = String(symbol || "").trim().toUpperCase().replace(/^\^/, "");
  const venue = String(exchange || "").trim().toUpperCase();

  const matches = INSTRUMENTS.filter(
    (instrument) =>
      instrument.symbol.replace(/^\^/, "").toUpperCase() === needle &&
      (!venue || instrument.exchange === venue)
  );

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    // Prefer the equity listing when a bare symbol exists on several venues.
    return matches.find((instrument) => instrument.assetType === "equity") || matches[0];
  }
  return null;
}

/**
 * Build an instrument for a symbol that is not in the catalog (e.g. a provider
 * search result). Identity is derived, so it is explicitly marked unresolved.
 */
export function instrumentFromSymbol(symbol, exchange = "") {
  const cleanSymbol = String(symbol || "").trim().toUpperCase();
  const venue = String(exchange || "").trim().toUpperCase();

  // An empty or malformed symbol cannot be derived into a real identity, so it
  // is rejected instead of producing an instrument like "US-EQ-".
  if (!/^\^?[A-Z0-9._:&-]{1,40}$/.test(cleanSymbol)) return null;

  const known = findInstrumentBySymbol(cleanSymbol, venue);
  if (known) return known;

  const country = venue === "BSE" || venue === "NSE" ? "IN" : "US";
  return normalizeInstrument({
    symbol: cleanSymbol,
    name: cleanSymbol,
    exchange: venue || "UNKNOWN",
    country
  });
}

/**
 * Provider-specific ticker. Explicit mappings win; equities and ETFs can be
 * derived from the exchange suffix convention; indices without a mapping are
 * unsupported rather than guessed.
 */
export function resolveProviderSymbol(instrument, providerId) {
  if (!instrument) return null;
  const explicit = instrument.providers?.[providerId];
  if (explicit) return explicit;

  // Indices use provider-specific conventions that cannot be derived, so they
  // require an explicit mapping. ETFs are exchange-listed and follow the same
  // convention as equities.
  if (instrument.assetType === "index") return null;

  if (providerId === "fmp") {
    if (instrument.country !== "IN") return instrument.symbol;
    return `${instrument.symbol}${instrument.exchange.includes("BSE") ? ".BO" : ".NS"}`;
  }

  if (providerId === "twelve") {
    return instrument.country === "IN" ? `${instrument.exchange}:${instrument.symbol}` : instrument.symbol;
  }

  return instrument.symbol;
}

export function supportsProvider(instrument, providerId) {
  return resolveProviderSymbol(instrument, providerId) !== null;
}

const FILTERABLE = ["country", "exchange", "assetType", "sector"];

function matchesFilters(instrument, filters = {}) {
  return FILTERABLE.every((key) => {
    const wanted = filters[key];
    if (!wanted) return true;
    const values = Array.isArray(wanted) ? wanted : [wanted];
    return values.some((value) => String(value).toUpperCase() === String(instrument[key]).toUpperCase());
  });
}

export function listInstruments(filters = {}) {
  return INSTRUMENTS.filter((instrument) => matchesFilters(instrument, filters));
}

/** Case-insensitive match on symbol, name and sector. Ranked: symbol matches first. */
export function searchInstruments(query, filters = {}) {
  const needle = String(query || "").trim().toUpperCase();
  const pool = listInstruments(filters);
  if (!needle) return pool;

  const scored = [];

  for (const instrument of pool) {
    const symbol = instrument.symbol.replace(/^\^/, "").toUpperCase();
    const name = instrument.name.toUpperCase();
    const sector = instrument.sector.toUpperCase();

    let score = -1;
    if (symbol === needle) score = 100;
    else if (symbol.startsWith(needle)) score = 80;
    else if (name.startsWith(needle)) score = 60;
    else if (name.includes(needle)) score = 40;
    else if (symbol.includes(needle)) score = 30;
    else if (sector.includes(needle)) score = 10;

    if (score >= 0) scored.push({ instrument, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.instrument.symbol.localeCompare(b.instrument.symbol))
    .map((entry) => entry.instrument);
}
