import { sentimentOutputSchema } from "../../shared/schemas/agentOutputs.js";
import { buildAgentMessages } from "./prompt.js";

const OUTPUT_CONTRACT = `{
  "summary": string, "observations": string[], "evidenceIds": string[], "confidence": "low|medium|high", "limitations": string[],
  "label": "positive|negative|neutral|mixed|unclear",
  "score": number between -1 and 1,
  "drivers": string[],
  "divergence": { "detected": boolean, "detail": string } | null,
  "coverage": { "articles": integer, "spanDays": number }
}`;

export const sentimentAgent = {
  id: "sentiment",
  role: "Sentiment Agent (perception)",
  promptVersion: "sentiment.v1",
  schema: sentimentOutputSchema,

  precheck(envelope) {
    return (envelope?.evidence?.items?.length ?? 0) >= 1 ? [] : ["at least one validated evidence item"];
  },

  buildMessages(envelope) {
    return buildAgentMessages({
      role: "Sentiment Agent (perception)",
      task:
        "Assess the tone of the supplied evidence and compare it with the supplied price behaviour. Sentiment is the tone of available information, not demand or supply. Report mixed evidence as mixed and say when coverage is too thin to characterise.",
      envelope,
      outputContract: OUTPUT_CONTRACT,
      rules: [
        "A single article is never the market's view; coverage.articles must match the number of items actually assessed.",
        "Divergence means tone and price direction disagree; only report it when both are present in the envelope.",
        "Score is a coarse summary of the supplied text, not a forecast."
      ]
    });
  }
};
