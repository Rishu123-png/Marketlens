export default function handler(_req, res) {
  const providers = { fmp: Boolean(process.env.FMP_API_KEY), twelveData: Boolean(process.env.TWELVE_DATA_API_KEY), alphaVantage: Boolean(process.env.ALPHA_VANTAGE_API_KEY), groq: Boolean(process.env.GROQ_API_KEY), news: Boolean(process.env.NEWS_API_KEY) };
  res.status(200).json({ ok:true, service:'marketlens-api', configured:Object.values(providers).some(Boolean), providers, timestamp:new Date().toISOString() });
}
