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

const ASSET_CODE = { equity: "EQ", index: "IDX", etf: "ETF", future: "FUT", option: "OPT" };

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

  // ---------------------------------------------------------------- India, BSE dual listings
  // The same company can list on both exchanges; identity stays separate because
  // price, currency and provider ticker are per listing. BSE tickers use the .BO
  // convention and are resolved by exchange, never by bare symbol.
  { id: "IN-EQ-RELIANCE-BSE", symbol: "RELIANCE", name: "Reliance Industries Ltd", exchange: "BSE", sector: "Energy" },
  { id: "IN-EQ-TCS-BSE", symbol: "TCS", name: "Tata Consultancy Services Ltd", exchange: "BSE", sector: "Information Technology" },
  { id: "IN-EQ-INFY-BSE", symbol: "INFY", name: "Infosys Ltd", exchange: "BSE", sector: "Information Technology" },
  { id: "IN-EQ-HDFCBANK-BSE", symbol: "HDFCBANK", name: "HDFC Bank Ltd", exchange: "BSE", sector: "Banking" },
  { id: "IN-EQ-ICICIBANK-BSE", symbol: "ICICIBANK", name: "ICICI Bank Ltd", exchange: "BSE", sector: "Banking" },
  { id: "IN-EQ-SBIN-BSE", symbol: "SBIN", name: "State Bank of India", exchange: "BSE", sector: "Banking" },
  { id: "IN-EQ-ITC-BSE", symbol: "ITC", name: "ITC Ltd", exchange: "BSE", sector: "Consumer Goods" },
  { id: "IN-EQ-LT-BSE", symbol: "LT", name: "Larsen & Toubro Ltd", exchange: "BSE", sector: "Industrials" },


  // ---------------------------------------------------------------- India, broader NSE master
  // Curated snapshot of widely followed NSE listings beyond the popular 20.
  // Presence here is a catalogue fact only: a provider may still be unable to
  // quote or chart a given instrument, and the coverage matrix reports that.
  { symbol: "HCLTECH", name: "HCL Technologies Ltd", exchange: "NSE", sector: "Information Technology" },
  { symbol: "WIPRO", name: "Wipro Ltd", exchange: "NSE", sector: "Information Technology" },
  { symbol: "TECHM", name: "Tech Mahindra Ltd", exchange: "NSE", sector: "Information Technology" },
  { symbol: "LTIM", name: "LTIMindtree Ltd", exchange: "NSE", sector: "Information Technology" },
  { symbol: "PERSISTENT", name: "Persistent Systems Ltd", exchange: "NSE", sector: "Information Technology" },
  { symbol: "COFORGE", name: "Coforge Ltd", exchange: "NSE", sector: "Information Technology" },
  { symbol: "MPHASIS", name: "Mphasis Ltd", exchange: "NSE", sector: "Information Technology" },
  { symbol: "OFSS", name: "Oracle Financial Services Software Ltd", exchange: "NSE", sector: "Information Technology" },
  { symbol: "KPITTECH", name: "KPIT Technologies Ltd", exchange: "NSE", sector: "Information Technology" },
  { symbol: "TATAELXSI", name: "Tata Elxsi Ltd", exchange: "NSE", sector: "Information Technology" },

  { symbol: "ASIANPAINT", name: "Asian Paints Ltd", exchange: "NSE", sector: "Consumer Goods" },
  { symbol: "NESTLEIND", name: "Nestle India Ltd", exchange: "NSE", sector: "Consumer Goods" },
  { symbol: "BRITANNIA", name: "Britannia Industries Ltd", exchange: "NSE", sector: "Consumer Goods" },
  { symbol: "DABUR", name: "Dabur India Ltd", exchange: "NSE", sector: "Consumer Goods" },
  { symbol: "GODREJCP", name: "Godrej Consumer Products Ltd", exchange: "NSE", sector: "Consumer Goods" },
  { symbol: "COLPAL", name: "Colgate-Palmolive (India) Ltd", exchange: "NSE", sector: "Consumer Goods" },
  { symbol: "TATACONSUM", name: "Tata Consumer Products Ltd", exchange: "NSE", sector: "Consumer Goods" },
  { symbol: "MARICO", name: "Marico Ltd", exchange: "NSE", sector: "Consumer Goods" },
  { symbol: "BERGEPAINT", name: "Berger Paints India Ltd", exchange: "NSE", sector: "Consumer Goods" },
  { symbol: "PIDILITIND", name: "Pidilite Industries Ltd", exchange: "NSE", sector: "Chemicals" },
  { symbol: "UNITDSPR", name: "United Spirits Ltd", exchange: "NSE", sector: "Consumer Goods" },
  { symbol: "TRENT", name: "Trent Ltd", exchange: "NSE", sector: "Retail" },
  { symbol: "PAGEIND", name: "Page Industries Ltd", exchange: "NSE", sector: "Retail" },
  { symbol: "BATAINDIA", name: "Bata India Ltd", exchange: "NSE", sector: "Retail" },
  { symbol: "DMART", name: "Avenue Supermarts Ltd", exchange: "NSE", sector: "Retail" },
  { symbol: "NYKAA", name: "FSN E-Commerce Ventures Ltd", exchange: "NSE", sector: "Retail" },

  { symbol: "BAJAJ-AUTO", name: "Bajaj Auto Ltd", exchange: "NSE", sector: "Automotive" },
  { symbol: "EICHERMOT", name: "Eicher Motors Ltd", exchange: "NSE", sector: "Automotive" },
  { symbol: "HEROMOTOCO", name: "Hero MotoCorp Ltd", exchange: "NSE", sector: "Automotive" },
  { symbol: "TVSMOTOR", name: "TVS Motor Company Ltd", exchange: "NSE", sector: "Automotive" },
  { symbol: "ASHOKLEY", name: "Ashok Leyland Ltd", exchange: "NSE", sector: "Automotive" },
  { symbol: "MOTHERSON", name: "Samvardhana Motherson International Ltd", exchange: "NSE", sector: "Automotive" },
  { symbol: "BOSCHLTD", name: "Bosch Ltd", exchange: "NSE", sector: "Automotive" },
  { symbol: "MRF", name: "MRF Ltd", exchange: "NSE", sector: "Automotive" },
  { symbol: "BALKRISIND", name: "Balkrishna Industries Ltd", exchange: "NSE", sector: "Automotive" },
  { symbol: "APOLLOTYRE", name: "Apollo Tyres Ltd", exchange: "NSE", sector: "Automotive" },

  { symbol: "INDUSINDBK", name: "IndusInd Bank Ltd", exchange: "NSE", sector: "Banking" },
  { symbol: "BANDHANBNK", name: "Bandhan Bank Ltd", exchange: "NSE", sector: "Banking" },
  { symbol: "FEDERALBNK", name: "Federal Bank Ltd", exchange: "NSE", sector: "Banking" },
  { symbol: "IDFCFIRSTB", name: "IDFC First Bank Ltd", exchange: "NSE", sector: "Banking" },
  { symbol: "PNB", name: "Punjab National Bank", exchange: "NSE", sector: "Banking" },
  { symbol: "BANKBARODA", name: "Bank of Baroda", exchange: "NSE", sector: "Banking" },
  { symbol: "CANBK", name: "Canara Bank", exchange: "NSE", sector: "Banking" },
  { symbol: "YESBANK", name: "Yes Bank Ltd", exchange: "NSE", sector: "Banking" },
  { symbol: "SBILIFE", name: "SBI Life Insurance Company Ltd", exchange: "NSE", sector: "Insurance" },
  { symbol: "HDFCLIFE", name: "HDFC Life Insurance Company Ltd", exchange: "NSE", sector: "Insurance" },
  { symbol: "ICICIPRULI", name: "ICICI Prudential Life Insurance Company Ltd", exchange: "NSE", sector: "Insurance" },
  { symbol: "LICI", name: "Life Insurance Corporation of India", exchange: "NSE", sector: "Insurance" },
  { symbol: "BAJAJFINSV", name: "Bajaj Finserv Ltd", exchange: "NSE", sector: "Financial Services" },
  { symbol: "CHOLAFIN", name: "Cholamandalam Investment and Finance Company Ltd", exchange: "NSE", sector: "Financial Services" },
  { symbol: "MUTHOOTFIN", name: "Muthoot Finance Ltd", exchange: "NSE", sector: "Financial Services" },
  { symbol: "SHRIRAMFIN", name: "Shriram Finance Ltd", exchange: "NSE", sector: "Financial Services" },
  { symbol: "JIOFIN", name: "Jio Financial Services Ltd", exchange: "NSE", sector: "Financial Services" },
  { symbol: "HDFCAMC", name: "HDFC Asset Management Company Ltd", exchange: "NSE", sector: "Financial Services" },
  { symbol: "RECLTD", name: "REC Ltd", exchange: "NSE", sector: "Financial Services" },
  { symbol: "PFC", name: "Power Finance Corporation Ltd", exchange: "NSE", sector: "Financial Services" },
  { symbol: "IRFC", name: "Indian Railway Finance Corporation Ltd", exchange: "NSE", sector: "Financial Services" },

  { symbol: "ULTRACEMCO", name: "UltraTech Cement Ltd", exchange: "NSE", sector: "Cement" },
  { symbol: "GRASIM", name: "Grasim Industries Ltd", exchange: "NSE", sector: "Cement" },
  { symbol: "SHREECEM", name: "Shree Cement Ltd", exchange: "NSE", sector: "Cement" },
  { symbol: "AMBUJACEM", name: "Ambuja Cements Ltd", exchange: "NSE", sector: "Cement" },
  { symbol: "ACC", name: "ACC Ltd", exchange: "NSE", sector: "Cement" },

  { symbol: "JSWSTEEL", name: "JSW Steel Ltd", exchange: "NSE", sector: "Metals" },
  { symbol: "TATASTEEL", name: "Tata Steel Ltd", exchange: "NSE", sector: "Metals" },
  { symbol: "HINDALCO", name: "Hindalco Industries Ltd", exchange: "NSE", sector: "Metals" },
  { symbol: "VEDL", name: "Vedanta Ltd", exchange: "NSE", sector: "Metals" },
  { symbol: "COALINDIA", name: "Coal India Ltd", exchange: "NSE", sector: "Metals" },
  { symbol: "NMDC", name: "NMDC Ltd", exchange: "NSE", sector: "Metals" },

  { symbol: "ONGC", name: "Oil and Natural Gas Corporation Ltd", exchange: "NSE", sector: "Energy" },
  { symbol: "BPCL", name: "Bharat Petroleum Corporation Ltd", exchange: "NSE", sector: "Energy" },
  { symbol: "IOC", name: "Indian Oil Corporation Ltd", exchange: "NSE", sector: "Energy" },
  { symbol: "GAIL", name: "GAIL (India) Ltd", exchange: "NSE", sector: "Energy" },
  { symbol: "PETRONET", name: "Petronet LNG Ltd", exchange: "NSE", sector: "Energy" },
  { symbol: "TATAPOWER", name: "Tata Power Company Ltd", exchange: "NSE", sector: "Utilities" },
  { symbol: "NHPC", name: "NHPC Ltd", exchange: "NSE", sector: "Utilities" },
  { symbol: "SJVN", name: "SJVN Ltd", exchange: "NSE", sector: "Utilities" },
  { symbol: "IEX", name: "Indian Energy Exchange Ltd", exchange: "NSE", sector: "Utilities" },

  { symbol: "ADANIPORTS", name: "Adani Ports and Special Economic Zone Ltd", exchange: "NSE", sector: "Infrastructure" },
  { symbol: "ADANIPOWER", name: "Adani Power Ltd", exchange: "NSE", sector: "Utilities" },
  { symbol: "ADANIGREEN", name: "Adani Green Energy Ltd", exchange: "NSE", sector: "Utilities" },
  { symbol: "RVNL", name: "Rail Vikas Nigam Ltd", exchange: "NSE", sector: "Infrastructure" },
  { symbol: "IRCTC", name: "Indian Railway Catering and Tourism Corporation Ltd", exchange: "NSE", sector: "Infrastructure" },
  { symbol: "INDIGO", name: "InterGlobe Aviation Ltd", exchange: "NSE", sector: "Aviation" },
  { symbol: "DLF", name: "DLF Ltd", exchange: "NSE", sector: "Real Estate" },
  { symbol: "GODREJPROP", name: "Godrej Properties Ltd", exchange: "NSE", sector: "Real Estate" },
  { symbol: "OBEROIRLTY", name: "Oberoi Realty Ltd", exchange: "NSE", sector: "Real Estate" },
  { symbol: "LODHA", name: "Macrotech Developers Ltd", exchange: "NSE", sector: "Real Estate" },

  { symbol: "DRREDDY", name: "Dr. Reddy's Laboratories Ltd", exchange: "NSE", sector: "Healthcare" },
  { symbol: "CIPLA", name: "Cipla Ltd", exchange: "NSE", sector: "Healthcare" },
  { symbol: "DIVISLAB", name: "Divi's Laboratories Ltd", exchange: "NSE", sector: "Healthcare" },
  { symbol: "APOLLOHOSP", name: "Apollo Hospitals Enterprise Ltd", exchange: "NSE", sector: "Healthcare" },
  { symbol: "MAXHEALTH", name: "Max Healthcare Institute Ltd", exchange: "NSE", sector: "Healthcare" },

  { symbol: "BEL", name: "Bharat Electronics Ltd", exchange: "NSE", sector: "Defence" },
  { symbol: "HAL", name: "Hindustan Aeronautics Ltd", exchange: "NSE", sector: "Defence" },
  { symbol: "BHEL", name: "Bharat Heavy Electricals Ltd", exchange: "NSE", sector: "Industrials" },
  { symbol: "SIEMENS", name: "Siemens Ltd", exchange: "NSE", sector: "Industrials" },
  { symbol: "ABB", name: "ABB India Ltd", exchange: "NSE", sector: "Industrials" },
  { symbol: "CUMMINSIND", name: "Cummins India Ltd", exchange: "NSE", sector: "Industrials" },
  { symbol: "HAVELLS", name: "Havells India Ltd", exchange: "NSE", sector: "Industrials" },
  { symbol: "DIXON", name: "Dixon Technologies (India) Ltd", exchange: "NSE", sector: "Industrials" },
  { symbol: "VOLTAS", name: "Voltas Ltd", exchange: "NSE", sector: "Industrials" },
  { symbol: "CROMPTON", name: "Crompton Greaves Consumer Electricals Ltd", exchange: "NSE", sector: "Industrials" },
  { symbol: "POLYCAB", name: "Polycab India Ltd", exchange: "NSE", sector: "Industrials" },
  { symbol: "SRF", name: "SRF Ltd", exchange: "NSE", sector: "Chemicals" },
  { symbol: "PIIND", name: "PI Industries Ltd", exchange: "NSE", sector: "Chemicals" },
  { symbol: "UPL", name: "UPL Ltd", exchange: "NSE", sector: "Chemicals" },
  { symbol: "INDHOTEL", name: "Indian Hotels Company Ltd", exchange: "NSE", sector: "Hospitality" },
  { symbol: "NAUKRI", name: "Info Edge (India) Ltd", exchange: "NSE", sector: "Internet" },
  { symbol: "PAYTM", name: "One 97 Communications Ltd", exchange: "NSE", sector: "Internet" },
  { symbol: "ZOMATO", name: "Eternal Ltd", exchange: "NSE", sector: "Internet" },

  // ---------------------------------------------------------------- India, BSE-only listings
  { symbol: "BSE", name: "BSE Ltd", exchange: "BSE", sector: "Financial Services" },
  { symbol: "CDSL", name: "Central Depository Services (India) Ltd", exchange: "NSE", sector: "Financial Services" },

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
    id: "IN-IDX-NIFTYBANK",
    symbol: "^NSEBANK",
    name: "Nifty Bank",
    exchange: "NSE",
    assetType: "index",
    sector: "Banking",
    providers: { fmp: "^NSEBANK" }
  },
  {
    id: "IN-IDX-NIFTYIT",
    symbol: "^CNXIT",
    name: "Nifty IT",
    exchange: "NSE",
    assetType: "index",
    sector: "Information Technology",
    providers: { fmp: "^CNXIT" }
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
  // ---------------------------------------------------------------- India, derivatives
  // Identity templates, not live contracts. A front-month contract changes
  // expiry every month, so pinning a date here would silently become stale.
  // These entries exist to prove exchange/underlying identity and to make the
  // honest answer visible: no configured zero-budget provider supplies Indian
  // derivative quotes or candles, and no provider symbol is guessed.
  {
    id: "IN-FUT-NIFTY50-FRONT",
    symbol: "NIFTY-FUT",
    name: "Nifty 50 futures (front-month template)",
    exchange: "NSE",
    assetType: "future",
    sector: "Broad Market",
    underlyingId: "IN-IDX-NIFTY50",
    contractTemplate: true,
    expiry: null,
    lotSize: 65,
    lotSizeStatus: "verified",
    lotSizeEffectiveFrom: "2025-12-30",
    lotSizeSource: "NSE circular NSE/FAOP/70616 (2025-10-03), https://nsearchives.nseindia.com/content/circulars/FAOP70616.pdf"
  },
  {
    id: "IN-FUT-NIFTYBANK-FRONT",
    symbol: "BANKNIFTY-FUT",
    name: "Nifty Bank futures (front-month template)",
    exchange: "NSE",
    assetType: "future",
    sector: "Banking",
    underlyingId: "IN-IDX-NIFTYBANK",
    contractTemplate: true,
    expiry: null,
    lotSize: 30,
    lotSizeStatus: "verified",
    lotSizeEffectiveFrom: "2025-12-30",
    lotSizeSource: "NSE circular NSE/FAOP/70616 (2025-10-03), https://nsearchives.nseindia.com/content/circulars/FAOP70616.pdf"
  },
  {
    id: "IN-OPT-NIFTY50-ATM-FRONT",
    symbol: "NIFTY-ATM-OPT",
    name: "Nifty 50 ATM option (front-month template)",
    exchange: "NSE",
    assetType: "option",
    sector: "Broad Market",
    underlyingId: "IN-IDX-NIFTY50",
    contractTemplate: true,
    expiry: null,
    strike: null,
    optionType: null,
    lotSize: 65,
    lotSizeStatus: "verified",
    lotSizeEffectiveFrom: "2025-12-30",
    lotSizeSource: "NSE circular NSE/FAOP/70616 (2025-10-03), https://nsearchives.nseindia.com/content/circulars/FAOP70616.pdf"
  },

  // ---------------------------------------------------------------- ETFs
  {
    id: "IN-ETF-BANKBEES",
    symbol: "BANKBEES",
    name: "Nippon India Nifty Bank BeES",
    exchange: "NSE",
    assetType: "etf",
    sector: "Banking"
  },
  {
    id: "IN-ETF-GOLDBEES",
    symbol: "GOLDBEES",
    name: "Nippon India Gold BeES",
    exchange: "NSE",
    assetType: "etf",
    sector: "Commodities"
  },
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
    providers: raw.providers ? Object.freeze({ ...raw.providers }) : null,
    // Derivative identity is carried only when supplied. Equities and indices
    // do not acquire null derivative fields just because the schema allows them.
    ...(raw.underlyingId ? { underlyingId: raw.underlyingId } : {}),
    ...(raw.contractTemplate !== undefined ? { contractTemplate: raw.contractTemplate } : {}),
    ...(raw.expiry !== undefined ? { expiry: raw.expiry } : {}),
    ...(raw.strike !== undefined ? { strike: raw.strike } : {}),
    ...(raw.optionType !== undefined ? { optionType: raw.optionType } : {}),
    ...(raw.lotSize !== undefined ? { lotSize: raw.lotSize } : {}),
    ...(raw.lotSizeStatus ? { lotSizeStatus: raw.lotSizeStatus } : {}),
    ...(raw.lotSizeEffectiveFrom ? { lotSizeEffectiveFrom: raw.lotSizeEffectiveFrom } : {}),
    ...(raw.lotSizeSource ? { lotSizeSource: raw.lotSizeSource } : {})
  });
}

export const INSTRUMENTS = Object.freeze(RAW_INSTRUMENTS.map(normalizeInstrument));

const BY_ID = new Map(INSTRUMENTS.map((instrument) => [instrument.id, instrument]));

/**
 * Legacy "popular NSE" list: the curated first 20 Indian equities. It is a
 * bounded subset used by the legacy /api/universe and ranking endpoints, not the
 * whole catalogue — the full master is INSTRUMENTS.
 */
export const POPULAR_INDIAN_EQUITY_IDS = Object.freeze([
  "IN-EQ-RELIANCE",
  "IN-EQ-TCS",
  "IN-EQ-INFY",
  "IN-EQ-HDFCBANK",
  "IN-EQ-ICICIBANK",
  "IN-EQ-SBIN",
  "IN-EQ-BHARTIARTL",
  "IN-EQ-ITC",
  "IN-EQ-LT",
  "IN-EQ-HINDUNILVR",
  "IN-EQ-MARUTI",
  "IN-EQ-SUNPHARMA",
  "IN-EQ-TITAN",
  "IN-EQ-AXISBANK",
  "IN-EQ-BAJFINANCE",
  "IN-EQ-KOTAKBANK",
  "IN-EQ-MM",
  "IN-EQ-ADANIENT",
  "IN-EQ-NTPC",
  "IN-EQ-POWERGRID"
]);

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

  // Indices and derivatives use provider-specific conventions that cannot be
  // derived from an equity symbol, so they require an explicit mapping. ETFs
  // are exchange-listed and follow the equity convention.
  if (["index", "future", "option"].includes(instrument.assetType)) return null;

  if (providerId === "fmp") {
    if (instrument.country !== "IN") return instrument.symbol;
    return `${instrument.symbol}${instrument.exchange.includes("BSE") ? ".BO" : ".NS"}`;
  }

  if (providerId === "twelve") {
    if (instrument.country !== "IN") return instrument.symbol;
    return `${instrument.exchange.includes("BSE") ? "BSE" : "NSE"}:${instrument.symbol}`;
  }

  if (providerId === "alpha") {
    // Alpha Vantage addresses Indian listings with an exchange suffix. The bare
    // ticker is never used: it resolves to US/other listings.
    if (instrument.country !== "IN") return instrument.symbol;
    return `${instrument.symbol}.${instrument.exchange.includes("BSE") ? "BSE" : "NSE"}`;
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
