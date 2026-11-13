import { gateResultSchema } from "../../shared/schemas/gate.js";

/** A stored research artefact is not necessarily approved for publication. */
export function canPublishReport(report, job) {
  if (!report || !job || !["COMPLETED", "PARTIAL"].includes(job.status)) return false;
  if (!report.jobId || report.jobId !== job.jobId) return false;

  // Both persisted copies must be well-formed and agree on the decision that
  // produced this artefact. This also withholds retained reports during retries.
  const reportGate = gateResultSchema.safeParse(report.gate);
  const jobGate = gateResultSchema.safeParse(job.gate);
  if (!reportGate.success || !jobGate.success) return false;
  const a = reportGate.data;
  const b = jobGate.data;
  return ["PASS", "PASS_WITH_WARNINGS"].includes(a.verdict)
    && a.verdict === b.verdict
    && a.rulesVersion === b.rulesVersion
    && a.evaluatedAt === b.evaluatedAt;
}
