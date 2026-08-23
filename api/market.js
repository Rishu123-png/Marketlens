const CACHE_TTL_MS = 60_000;
const cache = new Map();

function send(res, status, body) {
  return res.status(status).json(body);
}

function getProviderOrder() {
  const primary = String(
    process.env.PRIMARY_MARKET_PROVIDER || "fmp"
  ).toLowerCase();

  const available = ["fmp", "twelve", "alpha"];

  return [
    primary,
    ...available.filter((provider) => provider !== primary)
  ].filter((provider) => available.includes(provider));
}

function getProviderSymbols(symbol) {
  const clean = String(symbol || "")
    .trim()
    .toUpperCase();

  return {
    fmp: clean,
    twelve: clean.includes(":") ? clean : `NSE:${clean}`,
    alpha: clean.includes(".") ? clean : `${clean}.BSE`
  };
}

async function getJson(url) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 10_000);

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
        text.slice(0, 200) ||
        `Provider HTTP ${response.status}`
      );
    }

    if (!response.ok) {
      throw new Error(
        data?.["Error Message"] ||
        data?.message ||
        data?.error ||
        `Provider HTTP ${response.status}`
      );
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Request timed out.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function numberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(
    String(value)
      .replace("%", "")
      .replace(/,/g, "")
  );

  return Number.isFinite(number) ? number : null;
}

function normalize(item, symbol, source) {
  return {
    symbol: symbol,

    price: numberOrNull(
      item.price ??
      item.close ??
      item["05. price"]
    ),

    change: numberOrNull(
      item.change ??
      item["09. change"]
    ),

    changePercent: numberOrNull(
      item.changesPercentage ??
      item.change_percent ??
      item["10. change percent"]
    ),

    dayHigh: numberOrNull(
      item.dayHigh ??
      item.high ??
      item["03. high"]
    ),

    dayLow: numberOrNull(
      item.dayLow ??
      item.low ??
      item["04. low"]
    ),

    open: numberOrNull(
      item.open ??
      item["02. open"]
    ),

    previousClose: numberOrNull(
      item.previousClose ??
      item["08. previous close"]
    ),

    volume: numberOrNull(
      item.volume ??
      item["06. volume"]
    ),

    source,

    updatedAt: new Date().toISOString()
  };
}

async function fetchFmp(symbol, originalSymbol) {
  const apiKey = process.env.FMP_API_KEY;

  if (!apiKey) {
    throw new Error("FMP API key is not configured.");
  }

  const url =
    `https://financialmodelingprep.com/api/v3/quote/` +
    `${encodeURIComponent(symbol)}` +
    `?apikey=${encodeURIComponent(apiKey)}`;

  const data = await getJson(url);

  if (!Array.isArray(data) || !data[0]) {
    throw new Error("FMP returned no quote for this symbol.");
  }

  if (data[0].price === null || data[0].price === undefined) {
    throw new Error("FMP returned no usable price.");
  }

  return normalize(
    data[0],
    originalSymbol,
    "Financial Modeling Prep"
  );
}

async function fetchTwelveData(symbol, originalSymbol) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Twelve Data API key is not configured."
    );
  }

  const url =
    `https://api.twelvedata.com/quote` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&apikey=${encodeURIComponent(apiKey)}`;

  const data = await getJson(url);

  if (data?.code || data?.message) {
    throw new Error(
      data.message ||
      "Twelve Data returned an error."
    );
  }

  if (
    data?.price === null ||
    data?.price === undefined
  ) {
    if (
      data?.close === null ||
      data?.close === undefined
    ) {
      throw new Error(
        "Twelve Data returned no usable quote."
      );
    }
  }

  return normalize(
    data,
    originalSymbol,
    "Twelve Data"
  );
}

async function fetchAlphaVantage(
  symbol,
  originalSymbol
) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Alpha Vantage API key is not configured."
    );
  }

  const url =
    `https://www.alphavantage.co/query` +
    `?function=GLOBAL_QUOTE` +
    `&symbol=${encodeURIComponent(symbol)}` +
    `&apikey=${encodeURIComponent(apiKey)}`;

  const data = await getJson(url);

  if (data?.Note) {
    throw new Error(data.Note);
  }

  if (data?.Information) {
    throw new Error(data.Information);
  }

  if (data?.["Error Message"]) {
    throw new Error(data["Error Message"]);
  }

  const quote = data?.["Global Quote"];

  if (
    !quote ||
    quote["05. price"] === null ||
    quote["05. price"] === undefined ||
    quote["05. price"] === ""
  ) {
    throw new Error(
      "Alpha Vantage returned no usable quote."
    );
  }

  return normalize(
    quote,
    originalSymbol,
    "Alpha Vantage"
  );
}

export default async function handler(req, res) {
  const symbol = String(
    req.query?.symbol || "RELIANCE"
  )
    .trim()
    .toUpperCase();

  if (!/^[A-Z0-9._:-]{1,40}$/.test(symbol)) {
    return send(res, 400, {
      error: "Invalid stock symbol."
    });
  }

  const cached = cache.get(symbol);

  if (
    cached &&
    Date.now() - cached.createdAt < CACHE_TTL_MS
  ) {
    return send(res, 200, {
      ...cached.data,
      cached: true
    });
  }

  const providerSymbols = getProviderSymbols(symbol);
  const providerOrder = getProviderOrder();

  const providers = {
    fmp: () =>
      fetchFmp(
        providerSymbols.fmp,
        symbol
      ),

    twelve: () =>
      fetchTwelveData(
        providerSymbols.twelve,
        symbol
      ),

    alpha: () =>
      fetchAlphaVantage(
        providerSymbols.alpha,
        symbol
      )
  };

  const errors = [];

  for (const provider of providerOrder) {
    try {
      const quote = await providers[provider]();

      const data = {
        ...quote,
        cached: false,
        fallbackUsed:
          provider !== providerOrder[0]
      };

      cache.set(symbol, {
        data,
        createdAt: Date.now()
      });

      return send(res, 200, data);
    } catch (error) {
      errors.push({
        provider,
        message:
          error instanceof Error
            ? error.message
            : "Unknown provider error"
      });
    }
  }

  return send(res, 503, {
    error:
      "No configured market-data provider could return a usable quote.",
    details: errors
  });
}