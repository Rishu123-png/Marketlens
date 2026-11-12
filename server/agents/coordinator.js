import { coordinatorOutputSchema } from "../../shared/schemas/agentOutputs.js";
import { buildAgentMessages } from "./prompt.js";

const SECTION = `{ "status": "available|unavailable|partial", "body": string }`;

const OUTPUT_CONTRACT = `{
  "summary": string, "observations": string[], "evidenceIds": string[], "confidence": "low|medium|high", "limitations": string[],
  "sections": {
    "summary": ${SECTION}, "marketContext": ${SECTION}, "chart": ${SECTION}, "technical": ${SECTION}, "news": ${SECTION},
    "sentiment": ${SECTION}, "risk": ${SECTION}, "conflicts": ${SECTION}, "whatToMonitor": ${SECTION}, "sourcesAndMethodology": ${SECTION}
  },
  "disagreements": string[],
  "agentStatus": { "chart": "COMPLETED|FAILED|SKIPPED|BLOCKED", "technical": ..., "news": ..., "sentiment": ..., "risk": ... }
}`;

export const coordinatorAgent = {
  id: "coordinator",
  role: "Coordinator Agent (synthesis)",
  promptVersion: "coordinator.v1",
  schema: coordinatorOutputSchema,

  precheck() {
    return [];
  },

  buildMessages(envelope, context = {}) {
    const specialistOutputs = (context.specialistOutputs || []).map((entry) => ({
      agent: entry.agent,
      status: entry.status,
      error: entry.error ?? null,
      output: entry.output ?? null
    }));

    const gate = context.gate ?? null;

    return buildAgentMessages({
      role: "Coordinator Agent (synthesis)",
      task:
        "Synthesise the specialist findings into the ten report sections. Sections whose specialist did not complete must be marked unavailable with a short explanation — never fill them. Preserve disagreements between specialists instead of resolving them by preference.",
      envelope: { ...envelope, specialistOutputs, deterministicGate: gate },
      outputContract: OUTPUT_CONTRACT,
      rules: [
        "A section is available only when its specialist returned COMPLETED output.",
        "If the deterministic gate is BLOCKED, say so in the risk section and in the summary; you cannot clear it.",
        "Never invent a finding, number, source or date that is absent from the specialist outputs.",
        "agentStatus must match the statuses supplied in specialistOutputs."
      ]
    });
  }
};
