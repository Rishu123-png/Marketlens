// Evidence coverage: what this deployment can actually retrieve, and what it
// cannot. No credentials are echoed; only configured/required flags.
import { buildCoverage } from "../server/evidence/coverage.js";
import { buildInstrumentMatrix } from "../server/instruments/service.js";

export default function handler(_req, res) {
  try {
    const coverage = buildCoverage();
    // Instrument-level truth: catalogued vs provider-mapped vs actually observed.
    const instruments = buildInstrumentMatrix();
    res.setHeader?.("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    return res.status(200).json({ ok: true, coverage, instruments });
  } catch (error) {
    return res.status(200).json({
      ok: false,
      error: error instanceof Error ? error.message : "Coverage could not be computed.",
      coverage: null
    });
  }
}
