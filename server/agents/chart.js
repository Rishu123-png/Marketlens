import { chartOutputSchema } from "../../shared/schemas/agentOutputs.js";
import { buildAgentMessages } from "./prompt.js";

const OUTPUT_CONTRACT = `{
  "summary": string, "observations": string[], "evidenceIds": string[], "confidence": "low|medium|high", "limitations": string[],
  "structure": string,
  "trend": { "label": "uptrend|downtrend|sideways|insufficient-history", "evidence": string[] },
  "zones": [{ "kind": "support|resistance", "low": number, "high": number, "touches": integer, "note": string|null }],
  "patterns": [{ "name": string, "status": "forming|completed|failed", "direction": "bullish|bearish|neutral"|null, "note": string|null }],
  "volumeObservations": string[],
  "timeframeFindings": string[]
}`;

export const chartAgent = {
  id: "chart",
  role: "Chart Agent (price structure)",
  promptVersion: "chart.v1",
  schema: chartOutputSchema,

  precheck(envelope) {
    const missing = [];
    if (!envelope?.chart) missing.push("deterministic chart analysis");
    if ((envelope?.marketContext?.candles?.count ?? 0) < 10) missing.push("at least 10 valid candles");
    return missing;
  },

  buildMessages(envelope) {
    return buildAgentMessages({
      role: "Chart Agent (price structure)",
      task:
        "Describe the historical price structure for this instrument. Interpret the supplied geometric analysis: trend structure, support/resistance zones, candlestick and chart patterns, and volume behaviour. Do not predict future prices and do not present a zone as a guaranteed level.",
      envelope,
      outputContract: OUTPUT_CONTRACT,
      rules: [
        "Report only patterns present in the supplied chart object; do not add patterns you were not given.",
        "If candle count is below the pattern minimum, mark those patterns unavailable instead of describing them.",
        "Zones are historical reaction areas, not future price levels."
      ]
    });
  }
};
