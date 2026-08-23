const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedData = null;
let cacheCreatedAt = 0;

const CANDIDATES = [
  {
    symbol: "RELIANCE",
    exchange: "NSE",
    name: "Reliance Industries Ltd"
  },
  {
    symbol: "TCS",
    exchange: "NSE",
    name: "Tata Consultancy Services Ltd"
  },
  {
    symbol: "INFY",
    exchange: "NSE",
    name: "Infosys Ltd"
  },
  {
    symbol: "HDFCBANK",
    exchange: "NSE",
    name: "HDFC Bank Ltd"
  },
  {
    symbol: "ICICIBANK",
    exchange: "NSE",
    name: "ICICI Bank Ltd"
  },
  {
    symbol: "SBIN",
    exchange: "NSE",
    name: "State Bank of India"
  },
  {
    symbol: "BHARTIARTL",
    exchange: "NSE",
    name: "Bharti Airtel Ltd"
  },
  {
    symbol: "ITC",
    exchange: "NSE",
    name: "ITC Ltd"
  },
  {
    symbol: "LT",
    exchange: "NSE",
    name: "Larsen & Toubro Ltd"
  },
  {
    symbol: "HINDUNILVR",
    exchange: "NSE",
    name: "Hindustan Unilever Ltd"
  },
  {
    symbol: "MARUTI",
    exchange: "NSE",
    name: "Maruti Suzuki India Ltd"
  },
  {
    symbol: "SUNPHARMA",
    exchange: "NSE",
    name: "Sun Pharmaceutical Industries Ltd"
  },
  {
    symbol: "TITAN",
    exchange: "NSE",
    name: "Titan Company Ltd"
  },
  {
    symbol: "AXISBANK",
    exchange: "NSE",
    name: "Axis Bank Ltd"
  },
  {
    symbol: "BAJFINANCE",
    exchange: "NSE",
    name: "Bajaj Finance Ltd"
  },
  {
    symbol: "KOTAKBANK",
    exchange: "NSE",
    name: "Kotak Mahindra Bank Ltd"
  },
  {
    symbol: "M&M",
    exchange: "NSE",
    name: "Mahindra & Mahindra Ltd"
  },
  {
    symbol: "ADANIENT",
    exchange: "NSE",
    name: "Adani Enterprises Ltd"
  },
  {
    symbol: "NTPC",
    exchange: "NSE",
    name: "NTPC Ltd"
  },
  {
    symbol: "POWERGRID",
    exchange: "NSE",
    name: "Power Grid Corporation of India Ltd"
  }
];

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
  }, 8_000);

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
        data?.message ||
        data?.error ||
        data?.["Error Message"] ||
        data?.Information ||
        `Provider HTTP ${response.status}`
      );
    }

    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        "Provider request timed out."
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeQuote(
  item,
  candidate,
  source,
  provider
) {
  const price = parseNumber(
    item.price ??
    item.close ??
    item["05. price"]
  );

  if (price === null) {
    throw new Error(
      `${source} returned no usable price.`
    );
  }

  return {
    mode: "verified",

    quoteVerified: true,

    symbol: candidate.symbol,

    name: candidate.name,

    exchange: candidate.exchange,

    price,

    change: parseNumber(
      item.change ??
      item["09. change"]
    ),

    changePercent: parseNumber(
      item.changesPercentage ??
      item.change_percent ??
      item["10. change percent"]
    ),

    open: parseNumber(
      item.open ??
      item["02. open"]
    ),

    previousClose: parseNumber(
      item.previousClose ??
      item["08. previous close"]
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

    volume: parseNumber(
      item.volume ??
      item["06. volume"]
    ),

    source,

    provider,

    updatedAt:
      new Date().toISOString()
  };
}

async function fetchFmp(candidate) {
  const apiKey =
    process.env.FMP_API_KEY;

  if (!apiKey) {
    throw new Error(
      "FMP key unavailable."
    );
  }

  const url =
    "https://financialmodelingprep.com/api/v3/quote/" +
    `${encodeURIComponent(candidate.symbol)}` +
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

  return normalizeQuote(
    data[0],
    candidate,
    "Financial Modeling Prep",
    "fmp"
  );
}

async function fetchTwelve(candidate) {
  const apiKey =
    process.env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Twelve Data key unavailable."
    );
  }

  const providerSymbol =
    `NSE:${candidate.symbol}`;

  const url =
    "https://api.twelvedata.com/quote" +
    `?symbol=${encodeURIComponent(providerSymbol)}` +
    `&apikey=${encodeURIComponent(apiKey)}`;

  const data =
    await getJson(url);

  if (
    data?.code ||
    data?.message ||
    data?.status === "error"
  ) {
    throw new Error(
      data?.message ||
      "Twelve Data returned an error."
    );
  }

  return normalizeQuote(
    data,
    candidate,
    "Twelve Data",
    "twelve"
  );
}

async function fetchAlpha(candidate) {
  const apiKey =
    process.env.ALPHA_VANTAGE_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Alpha Vantage key unavailable."
    );
  }

  const candidates = [
    candidate.symbol,
    `${candidate.symbol}.BSE`
  ];

  let lastError =
    "Alpha Vantage returned no quote.";

  for (const symbol of candidates) {
    try {
      const url =
        "https://www.alphavantage.co/query" +
        "?function=GLOBAL_QUOTE" +
        `&symbol=${encodeURIComponent(symbol)}` +
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
          candidate,
          "Alpha Vantage",
          "alpha"
        );
      }

      lastError =
        "Alpha Vantage returned no usable quote.";
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "Alpha Vantage failed.";
    }
  }

  throw new Error(lastError);
}

function getProviderOrder() {
  const primary = String(
    process.env.PRIMARY_MARKET_PROVIDER ||
    "fmp"
  ).toLowerCase();

  const available = [
    "fmp",
    "twelve",
    "alpha"
  ];

  return [
    primary,
    ...available.filter(
      (provider) =>
        provider !== primary
    )
  ].filter(
    (provider) =>
      available.includes(provider)
  );
}

async function fetchVerifiedQuote(
  candidate
) {
  const providers = {
    fmp: () =>
      fetchFmp(candidate),

    twelve: () =>
      fetchTwelve(candidate),

    alpha: () =>
      fetchAlpha(candidate)
  };

  const errors = [];

  for (
    const provider of getProviderOrder()
  ) {
    try {
      const quote =
        await providers[provider]();

      return {
        ...quote,

        providerErrors: errors
      };
    } catch (error) {
      errors.push({
        provider,

        message:
          error instanceof Error
            ? error.message
            : "Provider failed."
      });
    }
  }

  throw new Error(
    "No provider returned a verified quote."
  );
}

function calculateScore(stock) {
  const changePercent =
    Number(stock.changePercent);

  if (!Number.isFinite(changePercent)) {
    return null;
  }

  const range =
    stock.dayHigh !== null &&
    stock.dayLow !== null &&
    stock.price > 0
      ? (
          (stock.dayHigh -
            stock.dayLow) /
          stock.price
        ) * 100
      : null;

  let score =
    changePercent * 10;

  if (
    range !== null &&
    Number.isFinite(range)
  ) {
    score +=
      Math.min(range, 10) * 0.25;
  }

  if (
    stock.volume !== null &&
    stock.volume > 0
  ) {
    score += 1;
  }

  return Number(
    score.toFixed(3)
  );
}

async function runWithConcurrency(
  items,
  limit,
  worker
) {
  const results = [];
  let index = 0;

  async function runWorker() {
    while (true) {
      const currentIndex = index;

      index += 1;

      if (
        currentIndex >= items.length
      ) {
        return;
      }

      try {
        const value =
          await worker(
            items[currentIndex]
          );

        if (value) {
          results.push(value);
        }
      } catch {
        // Failed quotes are intentionally
        // excluded. No demo replacement.
      }

      await new Promise(
        (resolve) =>
          setTimeout(resolve, 250)
      );
    }
  }

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          limit,
          items.length
        )
      },
      runWorker
    )
  );

  return results;
}

export default async function handler(
  req,
  res
) {
  if (
    cachedData &&
    Date.now() - cacheCreatedAt <
      CACHE_TTL_MS
  ) {
    return send(res, 200, {
      ...cachedData,
      cached: true
    });
  }

  const verified =
    await runWithConcurrency(
      CANDIDATES,
      2,
      async (candidate) => {
        const quote =
          await fetchVerifiedQuote(
            candidate
          );

        const score =
          calculateScore(quote);

        if (score === null) {
          return null;
        }

        return {
          ...quote,
          score
        };
      }
    );

  const ranked =
    verified
      .sort(
        (a, b) =>
          b.score - a.score
      )
      .slice(0, 5);

  if (!ranked.length) {
    return send(res, 503, {
      error:
        "No verified stocks could be ranked with the currently configured providers."
    });
  }

  const response = {
    generatedAt:
      new Date().toISOString(),

    marketStatus:
      "Ranked only from successfully verified provider quotes.",

    universeSize:
      CANDIDATES.length,

    verifiedCount:
      verified.length,

    stocks: ranked
  };

  cachedData = response;
  cacheCreatedAt = Date.now();

  return send(res, 200, response);
}