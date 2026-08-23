// MarketLens provider gateway. Secrets stay on the Vercel server.
const json = (res, status, body) => res.status(status).json(body);

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(`Provider returned ${response.status}`);
  return data;
}

function normalizeFmpQuote(item, symbol) {
  return { symbol: item.symbol || symbol, price: item.price ?? null, change: item.change ?? null, changePercent: item.changesPercentage ?? null, dayHigh: item.dayHigh ?? null, dayLow: item.dayLow ?? null, open: item.open ?? null, previousClose: item.previousClose ?? null, volume: item.volume ?? null, source: 'Financial Modeling Prep', updatedAt: new Date().toISOString() };
}

export default async function handler(req, res) {
  const symbol = String(req.query?.symbol || 'RELIANCE').trim().toUpperCase();
  if (!/^[A-Z0-9._-]{1,30}$/.test(symbol)) return json(res, 400, { error: 'Invalid stock symbol.' });
  const key = process.env.FMP_API_KEY;
  if (!key) return json(res, 503, { error: 'FMP_API_KEY is not configured in Vercel.' });
  try {
    // FMP uses its documented stable quote endpoint. Indian-symbol support depends on the account/plan.
    const url = `https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(symbol)}?apikey=${encodeURIComponent(key)}`;
    const data = await fetchJson(url);
    if (!Array.isArray(data) || !data.length) return json(res, 404, { error: `No quote returned for ${symbol}. Check the provider symbol format and market coverage.` });
    return json(res, 200, normalizeFmpQuote(data[0], symbol));
  } catch (error) {
    return json(res, 502, { error: 'Market-data provider unavailable.', details: error.message });
  }
}
