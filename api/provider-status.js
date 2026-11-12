// Provider capability and configuration status.
//
// "configured" only means a credential (or feed list) exists. It does not mean
// the provider was reachable, permitted, quota-healthy or correct for a given
// symbol. Every capability carries its verification level explicitly.
import { newsProviderStatus } from "../server/news/providers/index.js";
import { filingProviderStatus } from "../server/news/filings/index.js";
import { storageStatus } from "../server/storage/index.js";
import { queueStatus } from "../server/jobs/queue.js";

const MARKET_KEYS = {
  fmp: "FMP_API_KEY",
  twelve: "TWELVE_DATA_API_KEY",
  alpha: "ALPHA_VANTAGE_API_KEY"
};

const AI_KEYS = { groq: "GROQ_API_KEY" };

const MARKET_CAPABILITIES = {
  fmp: { quotes: true, candles: false, indices: true },
  twelve: { quotes: true, candles: true, indices: "mapped-only" },
  alpha: { quotes: true, candles: true, indices: "mapped-only" }
};

export default function handler(_req, res) {
  const market = Object.fromEntries(
    Object.entries(MARKET_KEYS).map(([id, key]) => [
      id,
      {
        configured: Boolean(process.env[key]),
        capabilities: MARKET_CAPABILITIES[id],
        verification: process.env[key] ? "configured-unverified" : "not-configured"
      }
    ])
  );

  const ai = Object.fromEntries(
    Object.entries(AI_KEYS).map(([id, key]) => [id, { configured: Boolean(process.env[key]) }])
  );

  const news = newsProviderStatus();
  const filings = filingProviderStatus();

  res.status(200).json({
    ok: true,
    configured: {
      ...Object.fromEntries(Object.entries(MARKET_KEYS).map(([id, key]) => [id, Boolean(process.env[key])])),
      ...Object.fromEntries(Object.entries(AI_KEYS).map(([id, key]) => [id, Boolean(process.env[key])])),
      news: news.some((provider) => provider.configured),
      filings: filings.some((provider) => provider.configured)
    },
    market,
    ai,
    news,
    filings,
    storage: storageStatus(),
    queue: queueStatus(),
    verificationLevels: {
      "configured-unverified": "Credential present; live behaviour not validated in this environment.",
      "not-configured": "No credential; the capability is disabled and reported as unavailable.",
      "adapter-unverified": "Code path exists but the upstream contract has not been validated by an operator."
    },
    warning:
      "Configured only means a key exists. Provider permissions, quotas, symbol coverage and freshness must be tested per request.",
    checkedAt: new Date().toISOString()
  });
}
