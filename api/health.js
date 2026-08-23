export default function handler(_req, res) {
  res.status(200).json({ ok: true, service: 'marketlens-api', configured: Boolean(process.env.FMP_API_KEY), timestamp: new Date().toISOString() });
}
