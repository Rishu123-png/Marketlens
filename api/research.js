// Research job creation. This endpoint never runs the agents itself (O1):
// it validates the request, records a job and hands the job id to the queue.
import { RESEARCH_DEPTHS, REQUIRED_MODULES_BY_DEPTH } from "../shared/schemas/research.js";
import { getInstrument, instrumentFromSymbol } from "../shared/instruments/catalog.js";
import { getJobStore, resolveJobStore } from "../server/jobs/store.js";
import { getQueue, queueStatus } from "../server/jobs/queue.js";
import { rateLimit } from "../lib/server/rateLimit.js";

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return req.body;
}

function resolveInstrument(symbol, exchange) {
  if (!symbol) return null;
  return getInstrument(symbol) ?? instrumentFromSymbol(symbol, exchange);
}

export default async function handler(req, res) {
  if (req.method && req.method !== "POST") {
    res.setHeader?.("Allow", "POST");
    return res.status(405).json({
      error: "Use POST to create research jobs. Poll GET /api/jobs/[jobId] for results."
    });
  }

  const quota = await rateLimit(req, { name: "research", limit: 10, windowMs: 60_000 });
  if (!quota.allowed) {
    res.setHeader?.("Retry-After", String(quota.retryAfterSeconds));
    return res.status(429).json({
      error: "Too many research requests. Please try again shortly.",
      retryAfterSeconds: quota.retryAfterSeconds
    });
  }

  const body = readBody(req);
  if (!body) return res.status(400).json({ error: "Request body must be valid JSON." });

  const depth = String(body.depth || "quick").toLowerCase();
  if (!RESEARCH_DEPTHS.includes(depth)) {
    return res.status(400).json({ error: "Unsupported research depth.", supported: RESEARCH_DEPTHS });
  }

  const symbol = String(body.symbol || "").trim().toUpperCase();
  const instrument = resolveInstrument(symbol, String(body.exchange || "").trim().toUpperCase());
  if (!instrument) return res.status(400).json({ error: "A valid instrument symbol is required." });

  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({
      error: "AI service is not configured. Set GROQ_API_KEY before creating research jobs.",
      configuration: "GROQ_API_KEY"
    });
  }

  const store = await resolveJobStore();
  let job = store.create({
    instrumentId: instrument.id,
    depth,
    timeframe: body.timeframe || "1D",
    historyPeriod: body.historyPeriod || "1Y",
    newsLookbackDays: Number.isInteger(body.newsLookbackDays) ? body.newsLookbackDays : 30
  });

  job = store.transition(job.jobId, "VALIDATING", { reason: "request validated" });
  job = store.transition(job.jobId, "QUEUED", { reason: `queued for ${depth} research` });

  try {
    const delivery = await getQueue().enqueue({ jobId: job.jobId });

    return res.status(202).json({
      jobId: job.jobId,
      status: job.status,
      instrumentId: job.instrumentId,
      depth: job.depth,
      requestedModules: REQUIRED_MODULES_BY_DEPTH[depth],
      queue: delivery,
      queueStatus: queueStatus().active,
      poll: `/api/jobs/${job.jobId}`,
      note:
        delivery.queue === "memory"
          ? "The memory queue only works with a worker in the same process (local development). Configure QSTASH_TOKEN and WORKER_URL for production."
          : "The worker will pick this job up from QStash."
    });
  } catch (error) {
    store.fail(job.jobId, error instanceof Error ? error.message : "Queue delivery failed");
    return res.status(503).json({
      error: "Research job could not be queued.",
      details: error instanceof Error ? error.message : "Unknown queue failure"
    });
  }
}
