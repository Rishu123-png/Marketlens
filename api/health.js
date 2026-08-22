export default function handler(_req, res) {
  res.status(200).json({ ok: true, service: 'marketlens-api', configured: Boolean(process.env.MARKET_DATA_API_KEY), timestamp: new Date().toISOString() });
}
