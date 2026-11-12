import { riskOutputSchema } from "../../shared/schemas/agentOutputs.js";
import { buildAgentMessages } from "./prompt.js";

const OUTPUT_CONTRACT = `{
  "summary": string, "observations": string[], "evidenceIds": string[], "confidence": "low|medium|high", "limitations": string[],
  "dataQuality": { "status": "good|degraded|poor", "warnings": string[] },
  "volatility": { "level": "low|normal|elevated|extreme|unknown", "note": string|null },
  "conflicts": string[],
  "uncertainty": "low|medium|high",
  "publicationGate": "pass|warn|block",
  "gateReasons": string[]
}`;

export const riskAgent = {
  id: "risk",
  role: "Risk Agent (data quality and uncertainty)",
  promptVersion: "risk.v1",
  schema: riskOutputSchema,

  precheck() {
    return [];
  },

  buildMessages(envelope, context = {}) {
    const specialists = (context.specialistOutputs || [])
      .map((entry) => ({
        agent: entry.agent,
        status: entry.status,
        summary: entry.output?.summary ?? null,
        confidence: entry.output?.confidence ?? null
      }));

    return buildAgentMessages({
      role: "Risk Agent (data quality and uncertainty)",
      task:
        "Judge what could make this research misleading. Use the quality block, quote freshness, candle coverage, news coverage and the specialist findings. Your text can raise warnings and uncertainty, but the publication verdict itself is computed deterministically elsewhere; do not claim authority over it.",
      envelope: { ...envelope, specialistFindings: specialists },
      outputContract: OUTPUT_CONTRACT,
      rules: [
        "Report data-quality problems plainly; never soften a critical failure into a footnote.",
        "Do not force agreement between specialists. Where they disagree, list the disagreement.",
        "publicationGate is advisory text only; the deterministic gate is authoritative."
      ]
    });
  }
};
