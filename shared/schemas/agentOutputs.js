/**
 * Output contracts for the six agents.
 *
 * These schemas are the authority on what an agent may say, not the prompt. A
 * model response that does not satisfy its schema is rejected by
 * `runStructuredCompletion` and the agent is recorded as FAILED; nothing is
 * repaired or filled in.
 */

import { z } from "zod";
import { AGENT_IDS, agentFindingsSchema, CONFIDENCE_LEVELS } from "./agent.js";
import { isoTimestampSchema } from "./primitives.js";

const nullableText = z.string().min(1).max(2000).nullable();

const zoneSchema = z.object({
  kind: z.enum(["support", "resistance"]),
  low: z.number().finite(),
  high: z.number().finite(),
  touches: z.number().int().min(1).max(50),
  note: nullableText
});

const patternSchema = z.object({
  name: z.string().min(1).max(60),
  status: z.enum(["forming", "completed", "failed"]),
  direction: z.enum(["bullish", "bearish", "neutral"]).nullable(),
  note: nullableText
});

export const chartOutputSchema = agentFindingsSchema.extend({
  structure: z.string().min(1).max(2000),
  trend: z.object({
    label: z.enum(["uptrend", "downtrend", "sideways", "insufficient-history"]),
    evidence: z.array(z.string().min(1).max(300)).max(20)
  }),
  zones: z.array(zoneSchema).max(12),
  patterns: z.array(patternSchema).max(12),
  volumeObservations: z.array(z.string().min(1).max(500)).max(12),
  timeframeFindings: z.array(z.string().min(1).max(500)).max(12)
});

const indicatorReadingSchema = z.object({
  value: z.number().finite().nullable(),
  interpretation: z.string().min(1).max(600).nullable()
});

export const technicalOutputSchema = agentFindingsSchema.extend({
  indicators: z
    .object({
      rsi14: indicatorReadingSchema.nullable().optional(),
      macd: indicatorReadingSchema.nullable().optional(),
      sma20: indicatorReadingSchema.nullable().optional(),
      sma50: indicatorReadingSchema.nullable().optional(),
      sma200: indicatorReadingSchema.nullable().optional(),
      ema20: indicatorReadingSchema.nullable().optional(),
      atr14: indicatorReadingSchema.nullable().optional(),
      bollinger: indicatorReadingSchema.nullable().optional(),
      relativeVolume: indicatorReadingSchema.nullable().optional()
    })
    .catchall(indicatorReadingSchema.nullable()),
  agreement: z.enum(["agree", "mixed", "conflict", "insufficient"]),
  conflicts: z.array(z.string().min(1).max(500)).max(12),
  timeframeNotes: z.array(z.string().min(1).max(500)).max(12)
});

export const CLAIM_TYPES = ["confirmed", "reported", "opinion", "unverified"];

export const newsEventSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(300),
  publishedAt: isoTimestampSchema.nullable(),
  publisher: z.string().min(1).max(120),
  url: z.string().url().nullable(),
  category: z.enum([
    "company",
    "earnings",
    "regulatory",
    "industry",
    "macro",
    "geopolitical",
    "corporate-action",
    "other"
  ]),
  summary: z.string().min(1).max(600),
  claimType: z.enum(CLAIM_TYPES)
});

export const newsOutputSchema = agentFindingsSchema.extend({
  events: z.array(newsEventSchema).max(20),
  significance: z.array(z.string().min(1).max(500)).max(12),
  gaps: z.array(z.string().min(1).max(500)).max(12)
});

export const sentimentOutputSchema = agentFindingsSchema.extend({
  label: z.enum(["positive", "negative", "neutral", "mixed", "unclear"]),
  score: z.number().min(-1).max(1),
  drivers: z.array(z.string().min(1).max(500)).max(12),
  divergence: z
    .object({
      detected: z.boolean(),
      detail: z.string().min(1).max(600)
    })
    .nullable(),
  coverage: z.object({
    articles: z.number().int().min(0).max(500),
    spanDays: z.number().min(0).max(365)
  })
});

export const riskOutputSchema = agentFindingsSchema.extend({
  dataQuality: z.object({
    status: z.enum(["good", "degraded", "poor"]),
    warnings: z.array(z.string().min(1).max(600)).max(20)
  }),
  volatility: z.object({
    level: z.enum(["low", "normal", "elevated", "extreme", "unknown"]),
    note: nullableText
  }),
  conflicts: z.array(z.string().min(1).max(600)).max(20),
  uncertainty: z.enum(CONFIDENCE_LEVELS),
  publicationGate: z.enum(["pass", "warn", "block"]),
  gateReasons: z.array(z.string().min(1).max(600)).max(20)
});

const sectionSchema = z.object({
  status: z.enum(["available", "unavailable", "partial"]),
  body: z.string().min(1).max(4000)
});

export const COORDINATOR_SECTIONS = [
  "summary",
  "marketContext",
  "chart",
  "technical",
  "news",
  "sentiment",
  "risk",
  "conflicts",
  "whatToMonitor",
  "sourcesAndMethodology"
];

export const coordinatorOutputSchema = agentFindingsSchema.extend({
  sections: z
    .object({
      summary: sectionSchema,
      marketContext: sectionSchema,
      chart: sectionSchema,
      technical: sectionSchema,
      news: sectionSchema,
      sentiment: sectionSchema,
      risk: sectionSchema,
      conflicts: sectionSchema,
      whatToMonitor: sectionSchema,
      sourcesAndMethodology: sectionSchema
    })
    .strict(),
  disagreements: z.array(z.string().min(1).max(600)).max(12),
  agentStatus: z.partialRecord(z.enum(AGENT_IDS), z.enum(["COMPLETED", "FAILED", "SKIPPED", "BLOCKED"]))
});

export const AGENT_OUTPUT_SCHEMAS = Object.freeze({
  chart: chartOutputSchema,
  technical: technicalOutputSchema,
  news: newsOutputSchema,
  sentiment: sentimentOutputSchema,
  risk: riskOutputSchema,
  coordinator: coordinatorOutputSchema
});
