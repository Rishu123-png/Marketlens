import { z } from "zod";
import { instrumentIdSchema, isoTimestampSchema } from "./primitives.js";

export const EVIDENCE_SOURCE_TYPES = [
  "news",
  "filing",
  "announcement",
  "regulatory",
  "commentary",
  "market-data"
];

/**
 * `verification` records what kind of claim the source makes. Syndicated copies
 * of one story share a `dedupeFingerprint` and collapse to a single evidence
 * item, so repetition can never masquerade as independent confirmation.
 */
export const EVIDENCE_VERIFICATION = ["verified", "reported", "opinion", "unverified"];

export const evidenceSchema = z
  .object({
    id: z.string().min(3).max(64),
    sourceType: z.enum(EVIDENCE_SOURCE_TYPES),
    publisher: z.string().min(1).max(120),
    url: z.string().url().nullable(),
    publishedAt: isoTimestampSchema.nullable(),
    retrievedAt: isoTimestampSchema,
    instrumentIds: z.array(instrumentIdSchema).min(1),
    excerpt: z.string().max(4000).nullable(),
    verification: z.enum(EVIDENCE_VERIFICATION),
    dedupeFingerprint: z.string().min(8).max(128),
    metadata: z.record(z.string(), z.unknown()).nullable().optional()
  })
  .superRefine((item, context) => {
    if (item.url === null) {
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: "Evidence must reference a retrievable source URL"
      });
    }
    if (item.publishedAt && Date.parse(item.publishedAt) > Date.parse(item.retrievedAt)) {
      context.addIssue({
        code: "custom",
        path: ["publishedAt"],
        message: "Publication time cannot be after retrieval time"
      });
    }
  });
