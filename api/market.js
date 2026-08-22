// Vercel serverless endpoint. Connect your chosen licensed market-data provider here.
// Keep all secret API keys on Vercel, never in the browser.
export default async function handler(req, res) {
  const { symbol = 'RELIANCE' } = req.query || {};
  const base = process.env.MARKET_DATA_BASE_URL;
  const key = process.env.MARKET_DATA_API_KEY;
  if (!base || !key) return res.status(503).json({ error: 'Market data provider is not configured yet.', symbol });
  try {
    // Provider-specific mapping belongs here. Do not assume every provider uses the same query format.
    const url = new URL(base);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('apikey', key);
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: 'Market data provider error', details: data });
    return res.status(200).json(data);
  } catch (error) { return res.status(500).json({ error: 'Unable to reach market data provider' }); }
}
