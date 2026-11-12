import { technicalOutputSchema } from "../../shared/schemas/agentOutputs.js";
import { buildAgentMessages } from "./prompt.js";

const OUTPUT_CONTRACT = `{
  "summary": string, "observations": string[], "evidenceIds": string[], "confidence": "low|medium|high", "limitations": string[],
  "indicators": {
    "rsi14": { "value": number|null, "interpretation": string|null },
    "macd": { "value": number|null, "interpretation": string|null },
    "sma20": { "value": number|null, "interpretation": string|null },
    "sma50": { "value": number|null, "interpretation": string|null },
    "sma200": { "value": number|null, "interpretation": string|null },
    "ema20": { "value": number|null, "interpretation": string|null },
    "atr14": { "value": number|null, "interpretation": string|null },
    "bollinger": { "value": number|null, "interpretation": string|null },
    "relativeVolume": { "value": number|null, "interpretation": string|null }
  },
  "agreement": "agree|mixed|conflict|insufficient",
  "conflicts": string[],
  "timeframeNotes": string[]
}`;

export const technicalAgent = {
  id: "technical",
  role: "Technical Agent (indicator interpretation)",
  promptVersion: "technical.v1",
  schema: technicalOutputSchema,

  precheck(envelope) {
    const missing = [];
    if (!envelope?.technical) missing.push("calculated indicators");
    if ((envelope?.marketContext?.candles?.count ?? 0) < 35) missing.push("at least 35 candles for indicators");
    return missing;
  },

  buildMessages(envelope) {
    return buildAgentMessages({
      role: "Technical Agent (indicator interpretation)",
      task:
        "Interpret the supplied deterministic indicator values. Repeat each value exactly as given; you are interpreting, not calculating. Where the engine produced null, interpretation must be null. Describe agreement or conflict between indicators and state the history length they rest on.",
      envelope,
      outputContract: OUTPUT_CONTRACT,
      rules: [
        "Never compute an indicator or adjust a supplied value.",
        "An oversold or overbought reading is a description, never a trade signal.",
        "If the candle history is shorter than an indicator's warm-up window, say the reading is unreliable."
      ]
    });
  }
};
