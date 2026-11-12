import { z } from "zod";

/**
 * Output contract for the single-shot analysis endpoint (`POST /api/report`).
 *
 * This is the pre-agent report shape. It stays explicit so a model response that
 * drifts from the contract is rejected rather than rendered as if complete.
 */
export const analysisReportSchema = z.object({
  headline: z.string().min(1).max(300),
  summary: z.string().min(1).max(4000),
  marketRead: z.string().min(1).max(4000),
  strengths: z.array(z.string().min(1).max(1000)).max(10),
  risks: z.array(z.string().min(1).max(1000)).min(1).max(10),
  whatToMonitor: z.array(z.string().min(1).max(1000)).min(1).max(10),
  limitations: z.string().min(1).max(2000),
  dataIntegrity: z.string().min(1).max(1000)
});
