// MarketLens verified market-data gateway.
// Groq is intentionally NOT used here.
// This endpoint only returns provider-backed market quotes.

const CACHE_TTL_MS = 60_000;
const cache = new Map();

function send(res, status, body) {
  return res.status(status).json(body);
}

function parseNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(
    String(value)
      .replace(/,/g, "")
      .replace("%", "")
  );

  return Number.isFinite(number)
    ? number
    : null;
}

async function getJson(url) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 9_000);

  try {
    const response = await fetch(url, {
      signal: controller.signal
    });

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        text.slice(0, 250) ||
        `Provider HTTP ${response.status}`
      );
    }

    if (!response.ok) {
      throw new Error(
        data?.["Error Message"] ||
        data?.message ||
        data?.error ||
        data?.Information ||
        `Provider HTTP ${response.status}`
      );
    }

    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Provider request timed out.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function getProviderOrder() {
  const primary = String(
    process.env.PRIMARY_MARKET_PROVIDER || "fmp"
  ).toLowerCase();

  const available = [
    "fmp",
    "twelve",
    "alpha"
  ];

  return [
    primary,
    ...available.filter(
      (provider) => provider !== primary
    )
  ].filter(
    (provider) =>
      available.includes(provider)
  );
}

function getBaseSymbol(symbol) {
  return String(symbol)
    .trim()
    .toUpperCase()
    .replace(/^NSE:/, "")
    .replace(/^BSE:/, "")
    .replace(/\.BSE$/, "")
    .replace(/\.NSE$/, "");
}

function normalizeQuote(
  item,
  requestedSymbol,
  source,
  provider,
  exchange
) {
  return {
    mode: "verified",

    symbol:
      item.symbol ||
      item.ticker ||
      requestedSymbol,

    displaySymbol: requestedSymbol,

    exchange:
      exchange ||
      item.exchange ||
      item.stockExchange ||
      "Unknown",

    price: parseNumber(
      item.price ??
      item.close ??
      item["05. price"]
    ),

    change: parseNumber(
      item.change ??
      item["09. change"]
    ),

    changePercent: parseNumber(
      item.changesPercentage ??
      item.change_percent ??
      item["10. change percent"]
    ),

    dayHigh: parseNumber(
      item.dayHigh ??
      item.high ??
      item["03. high"]
    ),

    dayLow: parseNumber(
      item.dayLow ??
      item.low ??
      item["04. low"]
    ),

    open: parseNumber(
      item.open ??
      item["02. open"]
    ),

    previousClose: parseNumber(
      item.previousClose ??
      item["08. previous close"]
    ),

    volume: parseNumber(
      item.volume ??
      item["06. volume"]
    ),

    source,
    provider,

    quoteVerified: true,

    updatedAt: new Date().toISOString()
  };
}

async function fetchFmp(
  symbol,
  exchange
) {
  const apiKey =
    process.env.FMP_API_KEY;

  if (!apiKey) {
    throw new Error(
      "FMP API key is not configured."
    );
  }

  const baseSymbol =
    getBaseSymbol(symbol);

  const url =
    "https://financialmodelingprep.com/api/v3/quote/" +
    `${encodeURIComponent(baseSymbol)}` +
    `?apikey=${encodeURIComponent(apiKey)}`;

  const data =
    await getJson(url);

  if (
    !Array.isArray(data) ||
    !data[0]
  ) {
    throw new Error(
      "FMP returned no quote."
    );
  }

  if (
    data[0].price === null ||
    data[0].price === undefined
  ) {
    throw new Error(
      "FMP returned no usable price."
    );
  }

  return normalizeQuote(
    data[0],
    baseSymbol,
    "Financial Modeling Prep",
    "fmp",
    exchange
  );
}

async function fetchTwelve(
  symbol,
  exchange
) {
  const apiKey =
    process.env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Twelve Data API key is not configured."
    );
  }

  const baseSymbol =
    getBaseSymbol(symbol);

  const prefix =
    String(exchange || "")
      .toUpperCase()
      .includes("BSE")
      ? "BSE"
      : "NSE";

  const providerSymbol =
    symbol.includes(":")
      ? symbol
      : `${prefix}:${baseSymbol}`;

  const url =
    "https://api.twelvedata.com/quote" +
    `?symbol=${encodeURIComponent(providerSymbol)}` +
    `&apikey=${encodeURIComponent(apiKey)}`;

  const data =
    await getJson(url);

  if (data?.code || data?.message) {
    throw new Error(
      data.message ||
      data.code ||
      "Twelve Data returned an error."
    );
  }

  if (
    data?.price === null ||
    data?.price === undefined
  ) {
    throw new Error(
      "Twelve Data returned no usable price."
    );
  }

  return normalizeQuote(
    data,
    baseSymbol,
    "Twelve Data",
    "twelve",
    exchange
  );
}

async function fetchAlpha(
  symbol,
  exchange
) {
  const apiKey =
    process.env.ALPHA_VANTAGE_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Alpha Vantage API key is not configured."
    );
  }

  const baseSymbol =
    getBaseSymbol(symbol);

  const candidates = [
    symbol,
    baseSymbol
  ];

  if (
    String(exchange || "")
      .toUpperCase()
      .includes("BSE")
  ) {
    candidates.push(
      `${baseSymbol}.BSE`
    );
  }

  const uniqueCandidates =
    [...new Set(candidates)];

  let lastError =
    "Alpha Vantage returned no usable quote.";

  for (
    const candidate of uniqueCandidates
  ) {
    try {
      const url =
        "https://www.alphavantage.co/query" +
        "?function=GLOBAL_QUOTE" +
        `&symbol=${encodeURIComponent(candidate)}` +
        `&apikey=${encodeURIComponent(apiKey)}`;

      const data =
        await getJson(url);

      if (data?.Note) {
        throw new Error(data.Note);
      }

      if (data?.Information) {
        throw new Error(
          data.Information
        );
      }

      if (data?.["Error Message"]) {
        throw new Error(
          data["Error Message"]
        );
      }

      const quote =
        data?.["Global Quote"];

      if (
        quote?.["05. price"] !==
        undefined &&
        quote?.["05. price"] !== ""
      ) {
        return normalizeQuote(
          quote,
          baseSymbol,
          "Alpha Vantage",
          "alpha",
          exchange
        );
      }

      lastError =
        "Alpha Vantage returned no quote.";
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "Alpha Vantage failed.";
    }
  }

  throw new Error(lastError);
}

export async function getVerifiedQuote(symbol, exchange = "") {
  const normalizedSymbol = String(symbol || "")
    .trim()
    .toUpperCase();
  const normalizedExchange = String(exchange || "")
    .trim()
    .toUpperCase();

  if (!/^[A-Z0-9._:-]{1,40}$/.test(normalizedSymbol)) {
    const error = new Error("Invalid stock symbol.");
    error.statusCode = 400;
    throw error;
  }

  const cacheKey = `${normalizedSymbol}|${normalizedExchange}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return { ...cached.data, cached: true };
  }

  const providers = {
    fmp: () => fetchFmp(normalizedSymbol, normalizedExchange),
    twelve: () => fetchTwelve(normalizedSymbol, normalizedExchange),
    alpha: () => fetchAlpha(normalizedSymbol, normalizedExchange)
  };
  const providerOrder = getProviderOrder();
  const errors = [];

  for (let index = 0; index < providerOrder.length; index += 1) {
    const provider = providerOrder[index];
    try {
      const quote = await providers[provider]();
      if (quote.quoteVerified !== true || quote.price === null) {
        throw new Error(`${provider} returned no verified price.`);
      }
      const data = {
        ...quote,
        cached: false,
        fallbackUsed: index > 0,
        providerErrors: errors
      };
      cache.set(cacheKey, { data, createdAt: Date.now() });
      return data;
    } catch (error) {
      errors.push({
        provider,
        message: error instanceof Error ? error.message : "Unknown provider error"
      });
    }
  }

  const error = new Error("No configured provider could return a verified quote for this stock.");
  error.statusCode = 503;
  error.details = errors;
  throw error;
}

export default async function handler(req, res) {
  const symbol = String(req.query?.symbol || "").trim().toUpperCase();
  const exchange = String(req.query?.exchange || "").trim().toUpperCase();

  if (!symbol) {
    return send(res, 400, { error: "A stock symbol is required." });
  }

  try {
    return send(res, 200, await getVerifiedQuote(symbol, exchange));
  } catch (error) {
    return send(res, error.statusCode || 503, {
      error: error.message || "Market data unavailable.",
      ...(error.details ? { details: error.details } : {})
    });
  }
}
