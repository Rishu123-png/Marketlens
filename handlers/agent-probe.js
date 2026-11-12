/**
 * TEMPORARY production credential probe.
 *
 * This endpoint exists only to verify that each of the six agents selects its
 * own Groq credential against the deployed environment. It runs a fixed, tiny
 * prompt per agent — no caller-supplied prompt or model — and returns only
 * environment-variable names, modes, request counts and token usage.
 *
 * It is removed immediately after the verification run. It never returns or
 * stores a credential value.
 */

import { z } from "zod";
import { AGENT_IDS } from "../shared/schemas/agent.js";
import { getAgentConfig } from "../server/ai/config.js";
import { runAgent } from "../server/ai/runAgent.js";
import { rateLimit } from "../lib/server/rateLimit.js";

const schema = z.object({
  ok: z.boolean(),
  note: z.string().max(80).optional()
});

const prompt =
  "Credential routing check. Reply with JSON only: {\"ok\":true,\"note\":\"<one short word>\"}.";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader?.("Allow", "POST");
    return res.status(405).json({ error: "POST required." });
  }

  const quota = await rateLimit(req, { name: "agent-probe", limit: 2, windowMs: 5 * 60_000 });
  if (!quota.allowed) {
    res.setHeader?.("Retry-After", String(quota.retryAfterSeconds));
    return res.status(429).json({ error: "Probe rate limit reached.", retryAfterSeconds: quota.retryAfterSeconds });
  }

  const runs = await Promise.all(
    AGENT_IDS.map((agent) =>
      runAgent({
        agent,
        messages: [{ role: "user", content: prompt }],
        schema,
        config: getAgentConfig(agent)
      })
    )
  );

  return res.status(200).json({
    ok: true,
    note: "Temporary credential probe. Values are never returned; only variable names and usage.",
    agents: Object.fromEntries(
      runs.map((run) => [
        run.agent,
        {
          status: run.status,
          credentialEnvName: run.credentialEnvName ?? null,
          credentialMode: run.credentialMode ?? "none",
          model: run.model ?? null,
          requestCount: run.requestCount ?? 0,
          httpStatus: run.httpStatus ?? null,
          usage: run.usage ?? null,
          durationMs: run.durationMs ?? null,
          rateLimit: run.rateLimit ?? null,
          error: run.error ?? null
        }
      ])
    )
  });
}
