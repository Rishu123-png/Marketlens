// Eligibility-free historical candles gateway.
// It never places trades and never invents candles: only provider-returned rows are returned.

const ALLOWED_INTERVALS = new Set([
  "1min",
  "5min",
  "15min",
  "30min",
  "1h",
  "1day",
  "1week",
  "1month"
]);

function send(res, status, body) {
  return res.status(status).json(body);
}

async function getJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9_000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(text.slice(0, 180) || `Provider HTTP ${response.status}`);
    }

    if (!response.ok) {
      throw new Error(
        data?.["Error Message"] || data?.message || data?.error || `Provider HTTP ${response.status}`
      );
    }

    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Provider request timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function toCandles(rows, source) {
  return rows
    .map((row) => ({
      time: row.datetime || row.date || row.timestamp,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume) || null,
      source
    }))
    .filter(
      (candle) =>
        candle.time &&
        [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)
    )
    .reverse();
}

async function fetchTwelve(symbol, interval) {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("Twelve Data API key is not configured.");

  const data = await getJson(
    "https://api.twelvedata.com/time_series" +
      `?symbol=${encodeURIComponent(symbol)}` +
      `&interval=${encodeURIComponent(interval)}` +
      "&outputsize=365" +
      `&apikey=${encodeURIComponent(key)}`
  );

  if (data?.status === "error" || data?.code) {
    throw new Error(data?.message || "Twelve Data returned an error.");
  }

  if (!Array.isArray(data?.values)) {
    throw new Error("Twelve Data returned no candles.");
  }

  const candles = toCandles(data.values, "Twelve Data");
  if (!candles.length) throw new Error("Twelve Data returned no usable candles.");

  return { candles, source: "Twelve Data" };
}

async function fetchAlpha(symbol, interval) {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) throw new Error("Alpha Vantage API key is not configured.");

  const series =
    interval === "1day"
      ? "TIME_SERIES_DAILY"
      : interval === "1week"
        ? "TIME_SERIES_WEEKLY"
        : null;

  if (!series) {
    throw new Error("Alpha Vantage only supports 1day and 1week candles here.");
  }

  const data = await getJson(
    "https://www.alphavantage.co/query" +
      `?function=${series}` +
      `&symbol=${encodeURIComponent(symbol)}` +
      "&outputsize=compact" +
      `&apikey=${encodeURIComponent(key)}`
  );

  if (data?.Note) throw new Error(data.Note);
  if (data?.Information) throw new Error(data.Information);
  if (data?.["Error Message"]) throw new Error(data["Error Message"]);

  const seriesKey = Object.keys(data).find((key) => key.toLowerCase().includes("time series"));
  if (!seriesKey) throw new Error("Alpha Vantage returned no candles.");

  const rows = Object.entries(data[seriesKey]).map(([date, value]) => ({
    date,
    open: value["1. open"],
    high: value["2. high"],
    low: value["3. low"],
    close: value["4. close"],
    volume: value["5. volume"]
  }));

  const candles = toCandles(rows, "Alpha Vantage");
  if (!candles.length) throw new Error("Alpha Vantage returned no usable candles.");

  return { candles, source: "Alpha Vantage" };
}

export default async function handler(req, res) {
  const symbol = String(req.query?.symbol || "")
    .trim()
    .toUpperCase();

  if (!/^\^?[A-Z0-9._:&-]{1,40}$/.test(symbol)) {
    return send(res, 400, { error: "A valid symbol is required." });
  }

  const interval = String(req.query?.interval || "1day").trim();
  if (!ALLOWED_INTERVALS.has(interval)) {
    return send(res, 400, {
      error: "Unsupported interval.",
      supported: [...ALLOWED_INTERVALS]
    });
  }

  const providers = [
    { name: "twelve", run: () => fetchTwelve(symbol, interval) },
    { name: "alpha", run: () => fetchAlpha(symbol, interval) }
  ];

  const configured = providers.filter((provider) =>
    provider.name === "twelve"
      ? Boolean(process.env.TWELVE_DATA_API_KEY)
      : Boolean(process.env.ALPHA_VANTAGE_API_KEY)
  );

  if (!configured.length) {
    return send(res, 503, {
      error: "No historical market-data provider is configured.",
      details: providers.map((provider) => ({
        provider: provider.name,
        message: "API key is not configured."
      }))
    });
  }

  const errors = [];

  for (const provider of providers) {
    try {
      const { candles, source } = await provider.run();
      return send(res, 200, {
        mode: "historical",
        symbol,
        interval,
        candles,
        source,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      errors.push({
        provider: provider.name,
        message: error instanceof Error ? error.message : "Provider failed."
      });
    }
  }

  return send(res, 503, {
    error: "No verified historical candles are available for this symbol on the configured providers.",
    details: errors
  });
}
