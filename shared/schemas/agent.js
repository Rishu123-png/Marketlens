import { z } from "zod";
import { instrumentIdSchema, isoTimestampSchema, nonNegativeIntegerSchema } from "./primitives.js";

export const AGENT_IDS = ["chart", "news", "sentiment", "technical", "risk", "coordinator"];

export const AGENT_STATUSES = [
  "PENDING",
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "RETRYING",
  "SKIPPED",
  "BLOCKED"
];

export const CONFIDENCE_LEVELS = ["low", "medium", "high"];

export const agentIdSchema = z.enum(AGENT_IDS);
export const agentStatusSchema = z.enum(AGENT_STATUSES);

export const tokenUsageSchema = z.object({
  promptTokens: nonNegativeIntegerSchema,
  completionTokens: nonNegativeIntegerSchema,
  totalTokens: nonNegativeIntegerSchema
});

/**
 * The envelope every agent run returns. `schemaVersion` and `promptVersion` are
 * mandatory so a stored run can always be traced to the contract that produced
 * it.
 */
export const agentRunSchema = z
  .object({
    agent: agentIdSchema,
    status: agentStatusSchema,
    researchJobId: z.string().min(6).max(64).nullable().optional(),
    instrumentId: instrumentIdSchema.nullable().optional(),

    startedAt: isoTimestampSchema.nullable(),
    completedAt: isoTimestampSchema.nullable(),
    durationMs: nonNegativeIntegerSchema.nullable(),

    attempts: z.number().int().min(0).max(10),
    retries: nonNegativeIntegerSchema,

    provider: z.string().min(1).max(40).nullable(),
    model: z.string().min(1).max(120).nullable(),
    promptVersion: z.string().min(1).max(32),
    schemaVersion: z.string().min(1).max(32),

    output: z.record(z.string(), z.unknown()).nullable(),
    error: z.string().max(2000).nullable(),

    usage: tokenUsageSchema.nullable().optional(),

    // Credential routing telemetry. Only the environment-variable NAME and the
    // mode are stored; secret values and prefixes are never persisted.
    credentialEnvName: z.string().min(1).max(64).nullable().optional(),
    credentialMode: z.enum(["dedicated", "shared", "none"]).nullable().optional(),
    requestCount: nonNegativeIntegerSchema.max(100).optional(),
    httpStatus: z.number().int().min(100).max(599).nullable().optional(),
    rateLimit: z
      .object({
        remainingRequests: z.number().nonnegative().nullable().optional(),
        remainingTokens: z.number().nonnegative().nullable().optional(),
        resetRequests: z.string().max(80).nullable().optional(),
        resetTokens: z.string().max(80).nullable().optional()
      })
      .nullable()
      .optional(),

    // Audit of application-executed tool calls (Groq tool calling). The model can
    // only read data already present in the evidence envelope.
    toolCalls: z
      .array(
        z.object({
          name: z.string().min(1).max(40),
          ok: z.boolean().nullable().optional()
        })
      )
      .max(12)
      .optional(),
    toolRounds: nonNegativeIntegerSchema.max(6).optional(),
    toolsDisabled: z.boolean().optional(),

    // Recorded when a configured model was rejected as model_not_found and the
    // run continued on the fallback model. Never silent.
    modelFallback: z
      .object({
        from: z.string().min(1).max(120).nullable(),
        to: z.string().min(1).max(120)
      })
      .nullable()
      .optional()
  })
  .superRefine((run, context) => {
    if (run.status === "COMPLETED") {
      if (run.output === null) {
        context.addIssue({ code: "custom", path: ["output"], message: "A completed run must carry output" });
      }
      if (run.completedAt === null) {
        context.addIssue({
          code: "custom",
          path: ["completedAt"],
          message: "A completed run must record completedAt"
        });
      }
    }
    if (run.status === "FAILED" && !run.error) {
      context.addIssue({ code: "custom", path: ["error"], message: "A failed run must record an error" });
    }
  });

/**
 * Common findings block expected from specialist agents. Agents may add fields;
 * these must be present so the coordinator can distinguish claims from evidence.
 */
export const agentFindingsSchema = z.object({
  summary: z.string().min(1).max(4000),
  observations: z.array(z.string().min(1).max(1000)).max(40),
  evidenceIds: z.array(z.string().min(1).max(64)).max(200),
  confidence: z.enum(CONFIDENCE_LEVELS),
  limitations: z.array(z.string().min(1).max(1000)).max(20)
});
