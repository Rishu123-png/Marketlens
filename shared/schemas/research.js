import { z } from "zod";
import {
  instrumentIdSchema,
  isoTimestampSchema,
  nonNegativeIntegerSchema
} from "./primitives.js";
import { agentIdSchema, agentStatusSchema } from "./agent.js";
import { gateResultSchema } from "./gate.js";

export const JOB_STATUSES = [
  "CREATED",
  "VALIDATING",
  "BLOCKED",
  "QUEUED",
  "RUNNING",
  "PARTIAL",
  "COMPLETED",
  "FAILED",
  "CANCELLED"
];

export const RESEARCH_DEPTHS = ["quick", "standard", "comprehensive"];

export const RESEARCH_MODULES = ["quote", "technical", "chart", "news", "sentiment", "risk"];

/** Modules each depth must deliver. Missing mandatory modules block publication. */
export const REQUIRED_MODULES_BY_DEPTH = Object.freeze({
  quick: ["quote", "technical", "chart", "risk"],
  standard: ["quote", "technical", "chart", "news", "risk"],
  comprehensive: ["quote", "technical", "chart", "news", "sentiment", "risk"]
});

export const jobStatusSchema = z.enum(JOB_STATUSES);
export const researchDepthSchema = z.enum(RESEARCH_DEPTHS);
export const researchModuleSchema = z.enum(RESEARCH_MODULES);

export const jobEventSchema = z.object({
  from: jobStatusSchema.nullable(),
  to: jobStatusSchema,
  at: isoTimestampSchema,
  reason: z.string().max(500).nullable()
});

export const researchJobSchema = z.object({
  jobId: z.string().regex(/^research_[a-z0-9]{8,}$/, "Invalid research job id"),
  instrumentId: instrumentIdSchema,
  depth: researchDepthSchema,
  timeframe: z.string().min(1).max(16),
  historyPeriod: z.string().min(1).max(16),
  newsLookbackDays: nonNegativeIntegerSchema.max(3650),
  requestedModules: z.array(researchModuleSchema).min(1),
  status: jobStatusSchema,
  gate: gateResultSchema.nullable().optional(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  history: z.array(jobEventSchema).optional()
});

const reportSectionSchema = z.union([z.string().max(20000), z.array(z.string().max(2000)).max(50)]);

/** Section keys the coordinator must produce; missing keys are a contract error. */
export const REPORT_SECTIONS = [
  "executiveSummary",
  "instrument",
  "marketContext",
  "chart",
  "technical",
  "news",
  "sentiment",
  "risk",
  "conflicts",
  "observations",
  "limitations",
  "sources",
  "methodology"
];

export const researchReportSchema = z
  .object({
    reportId: z.string().regex(/^report_[a-z0-9]{8,}$/, "Invalid report id"),
    jobId: z.string().regex(/^research_[a-z0-9]{8,}$/, "Invalid research job id"),
    instrumentId: instrumentIdSchema,
    depth: researchDepthSchema,
    sections: z.record(z.string(), reportSectionSchema),
    // Only agents that actually ran appear here, so this is a partial map.
    agentStatus: z.partialRecord(agentIdSchema, agentStatusSchema),
    evidenceIds: z.array(z.string().min(1).max(64)).max(500),
    gate: gateResultSchema,
    methodology: z.string().min(1).max(4000),
    createdAt: isoTimestampSchema
  })
  .superRefine((report, context) => {
    for (const key of REPORT_SECTIONS) {
      if (!(key in report.sections)) {
        context.addIssue({
          code: "custom",
          path: ["sections", key],
          message: `Report is missing the "${key}" section`
        });
      }
    }
  });
