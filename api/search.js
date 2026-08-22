export default async function handler(req, res) {
  const q = String(req.query?.q || '').trim();
  if (q.length < 2) return res.status(400).json({ error: 'Search requires at least two characters.' });
  const base = process.env.MARKET_DATA_BASE_URL;
  const key = process.env.MARKET_DATA_API_KEY;
  if (!base || !key) return res.status(503).json({ error: 'Market data provider is not configured.' });
  try {
    const url = new URL(base); url.searchParams.set('q', q); url.searchParams.set('apikey', key);
    const r = await fetch(url); const data = await r.json();
    return res.status(r.status).json(data);
  } catch { return res.status(502).json({ error: 'Market data provider unavailable.' }); }
}
