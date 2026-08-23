// MarketLens real-data gateway.
// Market providers are used for verified quotes.
// Groq is ONLY used for research fallback and is never allowed
// to invent a live price, volume, change or other quote fields.

const CACHE_TTL_MS = 60_000;
const cache = new Map();

function send(res, status, body) {
  return res.status(status).json(body);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
    (provider) => available.includes(provider)
  );
}

function getProviderSymbols(symbol) {
  const clean = String(symbol || "")
    .trim()
    .toUpperCase();

  return {
    fmp: clean,
    twelve: clean.includes(":")
      ? clean
      : `NSE:${clean}`,
    alpha: clean.includes(".")
      ? clean
      : `${clean}.BSE`
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
      .replace(/,/g, "")
      .replace("%", "")
  );

  return Number.isFinite(number)
    ? number
    : null;
}

function normalize(
  item,
  originalSymbol,
  source,
  provider
) {
  return {
    mode: "verified",

    symbol: originalSymbol,

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

    provider,

    quoteVerified: true,

    updatedAt: new Date().toISOString(),

    research: null
  };
}

async function fetchFmp(
  providerSymbol,
  originalSymbol
) {
  const apiKey = process.env.FMP_API_KEY;

  if (!apiKey) {
    throw new Error(
      "FMP API key is not configured."
    );
  }

  const url =
    "https://financialmodelingprep.com/api/v3/quote/" +
    `${encodeURIComponent(providerSymbol)}` +
    `?apikey=${encodeURIComponent(apiKey)}`;

  const data = await getJson(url);

  if (!Array.isArray(data) || !data[0]) {
    throw new Error(
      "FMP returned no quote for this symbol."
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

  return normalize(
    data[0],
    originalSymbol,
    "Financial Modeling Prep",
    "fmp"
  );
}

async function fetchTwelveData(
  providerSymbol,
  originalSymbol
) {
  const apiKey =
    process.env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Twelve Data API key is not configured."
    );
  }

  const url =
    "https://api.twelvedata.com/quote" +
    `?symbol=${encodeURIComponent(providerSymbol)}` +
    `&apikey=${encodeURIComponent(apiKey)}`;

  const data = await getJson(url);

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
    "Twelve Data",
    "twelve"
  );
}

async function fetchAlphaVantage(
  providerSymbol,
  originalSymbol
) {
  const apiKey =
    process.env.ALPHA_VANTAGE_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Alpha Vantage API key is not configured."
    );
  }

  const url =
    "https://www.alphavantage.co/query" +
    "?function=GLOBAL_QUOTE" +
    `&symbol=${encodeURIComponent(providerSymbol)}` +
    `&apikey=${encodeURIComponent(apiKey)}`;

  const data = await getJson(url);

  if (data?.Note) {
    throw new Error(data.Note);
  }

  if (data?.Information) {
    throw new Error(data.Information);
  }

  if (data?.["Error Message"]) {
    throw new Error(
      data["Error Message"]
    );
  }

  const quote =
    data?.["Global Quote"];

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
    "Alpha Vantage",
    "alpha"
  );
}

async function createGroqResearch(
  symbol,
  providerErrors
) {
  const apiKey =
    process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Groq API key is not configured."
    );
  }

  const model =
    process.env.GROQ_MODEL ||
    "llama-3.3-70b-versatile";

  const prompt = `
You are the AI research layer of MarketLens.

Research the Indian listed company represented by this stock symbol:

${symbol}

IMPORTANT DATA INTEGRITY RULES:

1. MarketLens could not obtain a verified current quote from its configured market-data providers.
2. You MUST NOT invent or guess:
   - current stock price
   - today's change
   - percentage change
   - volume
   - market cap
   - P/E ratio
   - financial results
   - dividend values
   - any other time-sensitive number
3. If you cannot verify a fact from the information available to you, do not state it as current fact.
4. This is a RESEARCH FALLBACK, not a market-data replacement.
5. Do not give a BUY, SELL or guaranteed-return recommendation.
6. Be useful even without a verified live quote.

Return ONLY valid JSON with exactly these keys:

company,
summary,
business,
strengths,
risks,
whatToMonitor,
researchStatus

Rules for each field:

company:
Short company identification. If uncertain, say "Company identification should be verified."

summary:
A concise educational overview.

business:
What the company is generally known for.

strengths:
Array of 3 to 5 general research strengths.
Do not invent current financial numbers.

risks:
Array of 3 to 5 genuine categories of risk to research.

whatToMonitor:
Array of 4 to 6 things an investor should verify using real current data.

researchStatus:
Must say exactly:
"Research fallback — live quote unavailable and no market price has been generated."

Provider failures received by MarketLens:
${JSON.stringify(providerErrors)}
`;

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",

        Authorization:
          `Bearer ${apiKey}`
      },

      body: JSON.stringify({
        model,

        temperature: 0.1,

        response_format: {
          type: "json_object"
        },

        messages: [
          {
            role: "system",

            content:
              "You are a cautious financial research assistant. Never fabricate current prices, market statistics, financial metrics or live information."
          },

          {
            role: "user",

            content: prompt
          }
        ]
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      data?.error ||
      "Groq research request failed."
    );
  }

  const content =
    data?.choices?.[0]?.message
      ?.content;

  if (!content) {
    throw new Error(
      "Groq returned an empty response."
    );
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error(
      "Groq returned invalid research JSON."
    );
  }
}

export default async function handler(
  req,
  res
) {
  const symbol = String(
    req.query?.symbol || "RELIANCE"
  )
    .trim()
    .toUpperCase();

  if (
    !/^[A-Z0-9._:-]{1,40}$/.test(
      symbol
    )
  ) {
    return send(res, 400, {
      error: "Invalid stock symbol."
    });
  }

  const cached = cache.get(symbol);

  if (
    cached &&
    Date.now() - cached.createdAt <
      CACHE_TTL_MS
  ) {
    return send(res, 200, {
      ...cached.data,
      cached: true
    });
  }

  const providerSymbols =
    getProviderSymbols(symbol);

  const providerOrder =
    getProviderOrder();

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

  for (
    let index = 0;
    index < providerOrder.length;
    index += 1
  ) {
    const provider =
      providerOrder[index];

    try {
      const quote =
        await providers[provider]();

      const data = {
        ...quote,

        cached: false,

        fallbackUsed:
          index > 0,

        providerErrors: []
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

      // Small delay before the next provider.
      // This reduces immediate request bursts.
      if (
        index <
        providerOrder.length - 1
      ) {
        await sleep(250);
      }
    }
  }

  // FINAL FALLBACK:
  // Groq provides research ONLY.
  // It never provides an invented market quote.
  try {
    const research =
      await createGroqResearch(
        symbol,
        errors
      );

    const data = {
      mode: "research",

      symbol,

      price: null,
      change: null,
      changePercent: null,
      dayHigh: null,
      dayLow: null,
      open: null,
      previousClose: null,
      volume: null,

      source:
        "Groq AI Research Fallback",

      provider:
        "groq",

      quoteVerified: false,

      fallbackUsed: true,

      providerErrors: errors,

      updatedAt:
        new Date().toISOString(),

      research
    };

    // Research fallback cache:
    // 5 minutes to avoid unnecessary Groq calls.
    cache.set(symbol, {
      data,
      createdAt:
        Date.now() -
        CACHE_TTL_MS +
        300_000
    });

    return send(res, 200, data);
  } catch (groqError) {
    errors.push({
      provider: "groq",

      message:
        groqError instanceof Error
          ? groqError.message
          : "Unknown Groq error"
    });

    return send(res, 503, {
      error:
        "No verified market quote is available and the AI research fallback also failed.",

      details: errors
    });
  }
}