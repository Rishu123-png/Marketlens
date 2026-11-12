import { newsOutputSchema } from "../../shared/schemas/agentOutputs.js";
import { buildAgentMessages } from "./prompt.js";

const OUTPUT_CONTRACT = `{
  "summary": string, "observations": string[], "evidenceIds": string[], "confidence": "low|medium|high", "limitations": string[],
  "events": [{
    "id": string, "title": string, "publishedAt": string|null, "publisher": string, "url": string|null,
    "category": "company|earnings|regulatory|industry|macro|geopolitical|corporate-action|other",
    "summary": string, "claimType": "confirmed|reported|opinion|unverified"
  }],
  "significance": string[],
  "gaps": string[]
}`;

export const newsAgent = {
  id: "news",
  role: "News Agent (events)",
  promptVersion: "news.v1",
  schema: newsOutputSchema,

  precheck(envelope) {
    return (envelope?.evidence?.items?.length ?? 0) >= 1 ? [] : ["at least one validated news or filing item"];
  },

  buildMessages(envelope) {
    return buildAgentMessages({
      role: "News Agent (events)",
      task:
        "Extract and classify the events described by the supplied evidence items. Use only those items. Collapse near-duplicates that share a headline and never treat repeated syndication as independent confirmation. Record what is missing in gaps.",
      envelope,
      outputContract: OUTPUT_CONTRACT,
      rules: [
        "An event id must be the evidenceId of the item it came from, or the evidenceId plus a suffix for a second event in the same item.",
        "claimType follows the evidence: official filings are confirmed only if the evidence itself is the filing; general reporting is reported; commentary is opinion; anything else is unverified.",
        "Never promote a rumour to confirmed, and never summarise an article that is not in the evidence list."
      ]
    });
  }
};
