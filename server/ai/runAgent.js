/**
 * Completion runner: retries, timeouts, schema validation and usage accounting.
 *
 * Two levels:
 * - `runStructuredCompletion` — provider call → JSON parse → schema validation →
 *   retry policy. Throws on failure. Used where the caller maps errors itself.
 * - `runAgent` — wraps the above into a schema-valid `AgentRun` envelope and
 *   never throws for provider/schema problems, so a failed specialist becomes a
 *   recorded outcome instead of a crashed job.
 *
 * Retry policy: one retry for transient provider errors (429/5xx/network/
 * timeout) and for schema-invalid output. Configuration errors (missing key,
 * 400/401/403/404) are not retried.
 */

import { agentRunSchema } from "../../shared/schemas/agent.js";
import { getAgentConfig } from "./config.js";
import { AIProviderError, groqProvider } from "./providers/groq.js";
import { recordUsage } from "./usage.js";
import { executeToolCall } from "../agents/tools.js";

export class AICompletionError extends Error {
  constructor(message, { attempts = 0, retryable = false, cause } = {}) {
    super(message);
    this.name = "AICompletionError";
    this.attempts = attempts;
    this.retryable = retryable;
    this.statusCode = 502;
    if (cause) this.cause = cause;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Usage arrives in camelCase from the provider adapter (and is validated by
 * `tokenUsageSchema`), but tests and some callers use OpenAI's snake_case. Both
 * are accepted and normalised so multi-round tool usage is actually summed.
 */
function normalizeUsage(usage) {
  if (!usage) return null;

  const promptTokens = Number(usage.promptTokens ?? usage.prompt_tokens) || 0;
  const completionTokens = Number(usage.completionTokens ?? usage.completion_tokens) || 0;
  const totalTokens =
    Number(usage.totalTokens ?? usage.total_tokens) || promptTokens + completionTokens;

  return { promptTokens, completionTokens, totalTokens };
}

function mergeUsage(total, usage) {
  const next = normalizeUsage(usage);
  if (!next) return total;
  if (!total) return next;

  return {
    promptTokens: total.promptTokens + next.promptTokens,
    completionTokens: total.completionTokens + next.completionTokens,
    totalTokens: total.totalTokens + next.totalTokens
  };
}

function isToolUnsupported(error) {
  if (error?.kind === "tools-unsupported") return true;
  return (
    (error?.status === 400 || error?.status === 422) &&
    /tool|function|response_format/i.test(String(error?.message ?? ""))
  );
}
const MAX_BACKOFF_MS = 5_000;

function parseJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    throw new AIProviderError("AI response was not valid JSON.", {
      status: 502,
      retryable: true,
      kind: "schema"
    });
  }
}

/**
 * Delay before the next attempt, or `null` when retrying is pointless.
 *
 * A provider that asks us to wait longer than the cap gets no retry: holding a
 * serverless request open to sleep is worse than returning the rate-limit error
 * so the caller (or the job queue) can reschedule.
 */
function backoffDelay(error, attempt, baseMs) {
  if (Number.isFinite(error?.retryAfterSeconds)) {
    const retryAfterMs = error.retryAfterSeconds * 1000;
    if (retryAfterMs > MAX_BACKOFF_MS) return null;
    return Math.max(0, retryAfterMs);
  }
  return Math.min(baseMs * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

/**
 * @param {object} options
 * @param {Array<{role:string,content:string}>} options.messages
 * @param {import("zod").ZodTypeAny} options.schema Schema the parsed JSON must satisfy.
 * @param {object} options.config Resolved agent configuration.
 * @param {object} [options.provider] Provider adapter (defaults to Groq).
 * @param {(ms:number)=>Promise<void>} [options.sleep] Injectable for tests.
 * @param {() => Date} [options.now] Injectable clock.
 */
export async function runStructuredCompletion({
  messages,
  schema,
  config = {},
  provider = groqProvider,
  sleep = defaultSleep,
  now = () => new Date(),
  tools = null,
  toolContext = null,
  maxToolRounds = 2
} = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new TypeError("messages must be a non-empty array");
  }
  if (!schema || typeof schema.safeParse !== "function") {
    throw new TypeError("a schema with safeParse is required");
  }

  const retries = Number.isInteger(config.retries) ? config.retries : 0;
  const backoffMs = Number.isInteger(config.backoffMs) ? config.backoffMs : 400;
  const startedAt = now();
  const toolList = Array.isArray(tools) && tools.length ? tools : null;
  const rounds = Number.isInteger(maxToolRounds) && maxToolRounds >= 0 ? maxToolRounds : 2;
  const budget = { used: 0 };
  const baseMessages = messages;
  let attempts = 0;
  let lastError = null;
  let toolsDisabled = false;

  // A retired model is a configuration problem, not a transient one. If the
  // caller allows it, retry once with the configured fallback model and record
  // the substitution on the run so it is never silent.
  let activeModel = config.model;
  let modelFallback = null;
  let fallbackAttempted = false;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    attempts = attempt;
    const audit = [];
    let toolRounds = 0;
    let usageTotals = null;

    messages = baseMessages;

    try {
      // Tool calls are executed by application code between model turns. The
      // final round withholds tools so the model must answer in JSON.
      for (let round = 0; round <= rounds; round += 1) {
        const useTools = Boolean(toolList && toolContext && !toolsDisabled && round < rounds);

        let response;
        try {
          response = await provider.completeJson({
            messages,
            model: activeModel,
            temperature: config.temperature,
            maxOutputTokens: config.maxOutputTokens ?? null,
            timeoutMs: config.timeoutMs ?? 20_000,
            tools: useTools ? toolList : null
          });
        } catch (error) {
          if (useTools && isToolUnsupported(error)) {
            toolsDisabled = true;
            round -= 1; // retry this round without tools
            continue;
          }
          throw error;
        }

        const roundUsage = response.usage ?? null;
        usageTotals = mergeUsage(usageTotals, roundUsage);

        if (useTools && Array.isArray(response.toolCalls) && response.toolCalls.length) {
          toolRounds = round + 1;
          audit.push(
            ...response.toolCalls.map((call) => ({ name: call.name, ok: null }))
          );

          const assistantToolCalls = response.toolCalls.map((call) => ({
            id: call.id || `call_${audit.length}`,
            type: "function",
            function: { name: call.name, arguments: call.arguments ?? "{}" }
          }));

          const toolMessages = response.toolCalls.map((call, index) => {
            const outcome = executeToolCall(call, toolContext, budget);
            const entry = audit[audit.length - response.toolCalls.length + index];
            if (entry) entry.ok = outcome.ok;

            return {
              role: "tool",
              tool_call_id: assistantToolCalls[index].id,
              name: call.name,
              content: outcome.content
            };
          });

          messages = [
            ...messages,
            {
              role: "assistant",
              content: response.content || "",
              tool_calls: assistantToolCalls
            },
            ...toolMessages
          ];

          continue;
        }

        const parsed = parseJson(response.content);
        const validated = schema.safeParse(parsed);

        if (!validated.success) {
          throw new AIProviderError("AI output did not match the required schema.", {
            status: 502,
            retryable: true,
            kind: "schema",
            cause: validated.error
          });
        }

        recordUsage({
          agent: config.agent ?? "unknown",
          model: response.model ?? config.model ?? "unknown",
          usage: usageTotals
        });

        return {
          output: validated.data,
          usage: usageTotals,
          attempts,
          model: response.model ?? config.model ?? null,
          provider: response.provider ?? provider.id ?? null,
          durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
          toolCalls: audit.slice(0, 12),
          toolRounds,
          toolsDisabled,
          modelFallback
        };
      }

      throw new AIProviderError("AI tool loop ended without a final answer.", {
        status: 502,
        retryable: true
      });
    } catch (error) {
      lastError = error;

      if (
        error?.kind === "model-not-found" &&
        !fallbackAttempted &&
        config.modelFallback !== false &&
        config.fallbackModel &&
        config.fallbackModel !== activeModel
      ) {
        modelFallback = { from: activeModel ?? null, to: config.fallbackModel };
        activeModel = config.fallbackModel;
        fallbackAttempted = true;
        attempt -= 1; // a model substitution is not a retry
        continue;
      }

      const retryable = error?.retryable === true;

      if (!retryable || attempt > retries) break;

      const delay = backoffDelay(error, attempt, backoffMs);
      if (delay === null) break;
      await sleep(delay);
    }
  }

  throw new AICompletionError(lastError?.message || "AI completion failed.", {
    attempts,
    retryable: lastError?.retryable === true,
    cause: lastError
  });
}

/**
 * Execute one agent turn and return a validated `AgentRun`.
 * Provider and schema failures become `status: "FAILED"` runs; they are not
 * thrown, so the orchestrator can record a partial result honestly.
 */
export async function runAgent({
  agent,
  messages,
  schema,
  config,
  provider = groqProvider,
  jobId = null,
  instrumentId = null,
  sleep,
  now = () => new Date(),
  tools = null,
  toolContext = null
} = {}) {
  const resolved = config ?? getAgentConfig(agent);
  const startedAt = now();

  if (resolved.enabled === false) {
    return agentRunSchema.parse({
      agent,
      status: "SKIPPED",
      researchJobId: jobId,
      instrumentId,
      startedAt: startedAt.toISOString(),
      completedAt: startedAt.toISOString(),
      durationMs: 0,
      attempts: 0,
      retries: 0,
      provider: resolved.provider,
      model: resolved.model,
      promptVersion: resolved.promptVersion,
      schemaVersion: resolved.schemaVersion,
      output: null,
      error: "Agent is disabled by configuration.",
      usage: null
    });
  }

  try {
    const result = await runStructuredCompletion({
      messages,
      schema,
      config: resolved,
      provider,
      sleep,
      now,
      tools,
      toolContext
    });

    return agentRunSchema.parse({
      agent,
      status: "COMPLETED",
      researchJobId: jobId,
      instrumentId,
      startedAt: startedAt.toISOString(),
      completedAt: now().toISOString(),
      durationMs: result.durationMs,
      attempts: result.attempts,
      retries: Math.max(0, result.attempts - 1),
      provider: result.provider,
      model: result.model,
      promptVersion: resolved.promptVersion,
      schemaVersion: resolved.schemaVersion,
      output: result.output,
      error: null,
      usage: result.usage,
      toolCalls: result.toolCalls ?? [],
      toolRounds: result.toolRounds ?? 0,
      toolsDisabled: result.toolsDisabled === true,
      modelFallback: result.modelFallback ?? null
    });
  } catch (error) {
    return agentRunSchema.parse({
      agent,
      status: "FAILED",
      researchJobId: jobId,
      instrumentId,
      startedAt: startedAt.toISOString(),
      completedAt: now().toISOString(),
      durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
      attempts: error?.attempts ?? 0,
      retries: Math.max(0, (error?.attempts ?? 1) - 1),
      provider: resolved.provider,
      model: resolved.model,
      promptVersion: resolved.promptVersion,
      schemaVersion: resolved.schemaVersion,
      output: null,
      error: (error instanceof Error ? error.message : "Agent failed.").slice(0, 2000),
      usage: null
    });
  }
}
