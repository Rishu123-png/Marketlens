export default function handler(
  _req,
  res
) {
  const providers = {
    fmp: {
      configured: Boolean(
        process.env.FMP_API_KEY
      )
    },

    twelveData: {
      configured: Boolean(
        process.env.TWELVE_DATA_API_KEY
      )
    },

    alphaVantage: {
      configured: Boolean(
        process.env.ALPHA_VANTAGE_API_KEY
      )
    },

    groq: {
      configured: Boolean(
        process.env.GROQ_API_KEY
      )
    },

    news: {
      configured: Boolean(
        process.env.NEWS_API_KEY
      )
    },

    finnhub: {
      configured: Boolean(
        process.env.FINNHUB_API_KEY
      )
    }
  };

  res.status(200).json({
    ok: true,

    service: "marketlens-api",

    configured: Object.values(
      providers
    ).some(
      (provider) =>
        provider.configured
    ),

    providers,

    note:
      "Configured means the environment variable exists. It does not confirm API quota, subscription entitlement, symbol coverage or current provider availability.",

    timestamp:
      new Date().toISOString()
  });
}