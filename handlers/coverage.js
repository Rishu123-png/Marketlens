// Evidence coverage: what this deployment can actually retrieve, and what it
// cannot. No credentials are echoed; only configured/required flags.
import { buildCoverage } from "../server/evidence/coverage.js";

export default function handler(_req, res) {
  try {
    const coverage = buildCoverage();
    res.setHeader?.("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    return res.status(200).json({ ok: true, coverage });
  } catch (error) {
    return res.status(200).json({
      ok: false,
      error: error instanceof Error ? error.message : "Coverage could not be computed.",
      coverage: null
    });
  }
}
