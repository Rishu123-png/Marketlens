// Provider capability and configuration status.
//
// "configured" only means a credential (or feed list) exists. It does not mean
// the provider was reachable, permitted, quota-healthy or correct for a given
// symbol. Every capability carries its verification level explicitly.
import { newsProviderStatus } from "../server/news/providers/index.js";
import { filingProviderStatus } from "../server/news/filings/index.js";
import { storageStatus } from "../server/storage/index.js";
import { queueStatus } from "../server/jobs/queue.js";
import { buildCoverage } from "../server/evidence/coverage.js";
import { DEFAULT_MODEL, FALLBACK_MODEL, getAgentConfig } from "../server/ai/config.js";
import { describeGroqCredentials } from "../server/ai/credentials.js";
import { observationSnapshot } from "../server/market-data/observations.js";
import { PROVIDER_CAPABILITIES } from "../server/market-data/providers/index.js";
import { buildInstrumentMatrix } from "../server/instruments/service.js";
import { buildProviderRegistry, providerSelectionPlan } from "../server/market-data/registry.js";
import { getInstrument } from "../shared/instruments/catalog.js";

const MARKET_KEYS = {
  fmp: "FMP_API_KEY",
  twelve: "TWELVE_DATA_API_KEY",
  alpha: "ALPHA_VANTAGE_API_KEY"
};


export default function handler(_req, res) {
  const market = Object.fromEntries(
    Object.entries(MARKET_KEYS).map(([id, key]) => [
      id,
      {
        configured: Boolean(process.env[key]),
        capabilities: PROVIDER_CAPABILITIES[id],
        verification: process.env[key] ? "configured-unverified" : "not-configured"
      }
    ])
  );

  const groqCredentials = describeGroqCredentials(process.env);
  const ai = {
    groq: {
      configured: groqCredentials.anyConfigured,
      credentials: groqCredentials
    }
  };

  const news = newsProviderStatus();
  const filings = filingProviderStatus();
  const coverage = buildCoverage();
  const instruments = buildInstrumentMatrix();
  const observed = observationSnapshot();
  const registry = buildProviderRegistry({ env: process.env });
  const tcs = getInstrument("IN-EQ-TCS");
  const selectionExamples = tcs
    ? {
        tcsNseQuote: providerSelectionPlan({ instrument: tcs, capability: "quote" }),
        tcsNseDailyCandles: providerSelectionPlan({ instrument: tcs, capability: "candles", interval: "1day" })
      }
    : null;

  res.status(200).json({
    ok: true,
    configured: {
      ...Object.fromEntries(Object.entries(MARKET_KEYS).map(([id, key]) => [id, Boolean(process.env[key])])),
      groq: groqCredentials.anyConfigured,
      news: news.some((provider) => provider.configured),
      filings: filings.some((provider) => provider.configured)
    },
    market,
    providerRegistry: registry,
    providerSelection: selectionExamples,
    ai,
    news,
    filings,
    coverage,
    aiProvider: {
      id: "groq",
      role: "single AI backbone for all agents, one credential per agent",
      configured: groqCredentials.anyConfigured,
      credentials: groqCredentials,
      agents: Object.fromEntries(
        Object.entries(groqCredentials.agents).map(([agent, credential]) => {
          let model = null;
          try {
            model = getAgentConfig(agent).model;
          } catch {
            model = null;
          }
          return [agent, { ...credential, model }];
        })
      ),
      model: process.env.GROQ_MODEL || DEFAULT_MODEL,
      modelSource: process.env.GROQ_MODEL ? "GROQ_MODEL" : "default",
      fallbackModel: FALLBACK_MODEL,
      modelFallbackEnabled: !["off", "false", "0", "disabled"].includes(
        String(process.env.AI_MODEL_FALLBACK ?? "on").toLowerCase()
      ),
      supportedModels: ["openai/gpt-oss-120b", "openai/gpt-oss-20b"],
      modelNotes: [
        "llama-3.3-70b-versatile was retired for free/developer tiers on 2026-08-16 and returns HTTP 404 model_not_found.",
        "OpenAI gpt-oss models receive reasoning_effort=low; reasoning tokens share the completion budget.",
        "A retired or unavailable model triggers one recorded fallback (modelFallback on the run), never a silent swap."
      ],
      liveModelVerification: groqCredentials.anyConfigured ? "configured-unverified" : "not-configured",
      keyIsolationNote:
        "Dedicated keys isolate credentials and per-key accounting. They do not multiply Groq organisation/project rate limits."
    },
    groqCredentials,
    marketObservations: observed,
    instrumentCoverage: instruments.coverage,
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
