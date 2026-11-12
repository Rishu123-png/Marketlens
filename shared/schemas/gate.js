import { z } from "zod";
import { isoTimestampSchema } from "./primitives.js";

export const GATE_VERDICTS = ["PASS", "PASS_WITH_WARNINGS", "BLOCKED"];
export const GATE_CHECK_STATUSES = ["pass", "warn", "block", "skip"];

/** Bump whenever a rule or threshold changes, so stored reports stay explainable. */
export const GATE_RULES_VERSION = "1.0.0";

export const gateFindingSchema = z.object({
  rule: z.string().min(1).max(80),
  message: z.string().min(1).max(1000)
});

export const gateCheckSchema = z.object({
  rule: z.string().min(1).max(80),
  status: z.enum(GATE_CHECK_STATUSES),
  detail: z.string().max(1000)
});

/**
 * Deterministic publication decision. The verdict must agree with its findings:
 * BLOCKED needs at least one blocking finding, PASS cannot carry any finding,
 * PASS_WITH_WARNINGS needs warnings and no blocking findings.
 */
export const gateResultSchema = z
  .object({
    verdict: z.enum(GATE_VERDICTS),
    rulesVersion: z.string().min(1).max(16),
    evaluatedAt: isoTimestampSchema,
    checks: z.array(gateCheckSchema).min(1),
    blocking: z.array(gateFindingSchema),
    warnings: z.array(gateFindingSchema)
  })
  .superRefine((result, context) => {
    if (result.verdict === "BLOCKED" && result.blocking.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["blocking"],
        message: "A BLOCKED verdict requires at least one blocking finding"
      });
    }
    if (result.verdict !== "BLOCKED" && result.blocking.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["blocking"],
        message: "Only a BLOCKED verdict may carry blocking findings"
      });
    }
    if (result.verdict === "PASS" && result.warnings.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["warnings"],
        message: "A PASS verdict cannot carry warnings"
      });
    }
    if (result.verdict === "PASS_WITH_WARNINGS" && result.warnings.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["warnings"],
        message: "PASS_WITH_WARNINGS requires at least one warning"
      });
    }
  });
