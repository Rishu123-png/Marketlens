function send(res, status, body) {
  return res.status(status).json(body);
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
        text.slice(0, 200) ||
        `Provider HTTP ${response.status}`
      );
    }

    if (!response.ok) {
      throw new Error(
        data?.message ||
        data?.error ||
        data?.["Error Message"] ||
        `Provider HTTP ${response.status}`
      );
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function isIndianResult(result) {
  const text = [
    result.country,
    result.region,
    result.exchange,
    result.stockExchange,
    result.exchangeShortName
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  return (
    text.includes("INDIA") ||
    text.includes("NSE") ||
    text.includes("BSE")
  );
}

function cleanResult(result) {
  const symbol = String(
    result.symbol ||
    result.ticker ||
    ""
  )
    .trim()
    .toUpperCase();

  return {
    symbol,

    name:
      result.name ||
      result.instrument_name ||
      result["2. name"] ||
      symbol,

    exchange:
      result.exchange ||
      result.stockExchange ||
      result.exchangeShortName ||
      result["4. region"] ||
      "India",

    type:
      result.type ||
      result.instrument_type ||
      result["3. type"] ||
      "Stock"
  };
}

function dedupe(results) {
  const seen = new Set();

  return results.filter((item) => {
    const key =
      `${item.symbol}|${item.exchange}`;

    if (
      !item.symbol ||
      seen.has(key)
    ) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function searchFmp(query) {
  const key =
    process.env.FMP_API_KEY;

  if (!key) {
    return [];
  }

  const url =
    "https://financialmodelingprep.com/api/v3/search" +
    `?query=${encodeURIComponent(query)}` +
    "&limit=20" +
    `&apikey=${encodeURIComponent(key)}`;

  const data =
    await getJson(url);

  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .filter(isIndianResult)
    .map(cleanResult);
}

async function searchTwelve(query) {
  const key =
    process.env.TWELVE_DATA_API_KEY;

  if (!key) {
    return [];
  }

  const url =
    "https://api.twelvedata.com/symbol_search" +
    `?symbol=${encodeURIComponent(query)}` +
    `&apikey=${encodeURIComponent(key)}`;

  const data =
    await getJson(url);

  const rows =
    Array.isArray(data?.data)
      ? data.data
      : [];

  return rows
    .filter(isIndianResult)
    .map(cleanResult);
}

async function searchAlpha(query) {
  const key =
    process.env.ALPHA_VANTAGE_API_KEY;

  if (!key) {
    return [];
  }

  const url =
    "https://www.alphavantage.co/query" +
    "?function=SYMBOL_SEARCH" +
    `&keywords=${encodeURIComponent(query)}` +
    `&apikey=${encodeURIComponent(key)}`;

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

  const rows =
    Array.isArray(
      data?.bestMatches
    )
      ? data.bestMatches
      : [];

  return rows
    .map((item) => ({
      symbol: item["1. symbol"],
      name: item["2. name"],
      type: item["3. type"],
      exchange: item["4. region"]
    }))
    .filter(isIndianResult)
    .map(cleanResult);
}

export default async function handler(
  req,
  res
) {
  const query = String(
    req.query?.q || ""
  ).trim();

  if (query.length < 2) {
    return send(res, 400, {
      error:
        "Enter at least two characters."
    });
  }

  if (query.length > 60) {
    return send(res, 400, {
      error:
        "Search query is too long."
    });
  }

  const errors = [];
  const results = [];

  const searches = [
    {
      provider: "fmp",
      run: searchFmp
    },
    {
      provider: "twelve",
      run: searchTwelve
    },
    {
      provider: "alpha",
      run: searchAlpha
    }
  ];

  for (const item of searches) {
    try {
      const providerResults =
        await item.run(query);

      results.push(
        ...providerResults
      );
    } catch (error) {
      errors.push({
        provider: item.provider,

        message:
          error instanceof Error
            ? error.message
            : "Search provider failed."
      });
    }
  }

  const finalResults =
    dedupe(results).slice(0, 20);

  if (!finalResults.length) {
    return send(res, 404, {
      error:
        "No Indian stock matches were returned by the configured search providers.",

      details: errors
    });
  }

  return send(res, 200, {
    query,

    results: finalResults,

    providerErrors: errors
  });
}