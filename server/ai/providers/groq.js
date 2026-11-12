import { DEFAULT_MODEL } from "../config.js";

/**
 * Groq adapter.
 *
 * One configured credential is used for every logical agent. Keys are never
 * rotated to evade rate limits — 429s are surfaced with their retry delay and
 * the caller backs off or fails honestly.
 */

export class AIProviderError extends Error {
  constructor(message, { status = null, retryable = false, retryAfterSeconds = null, kind = "provider", cause } = {}) {
    super(message);
    this.name = "AIProviderError";
    this.kind = kind;
    this.status = status;
    this.retryable = retryable;
    this.retryAfterSeconds = retryAfterSeconds;
    if (cause) this.cause = cause;
  }
}

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

function parseRetryAfter(headers) {
  const raw = headers?.get?.("retry-after");
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export const groqProvider = {
  id: "groq",
  label: "Groq",

  isConfigured(env = process.env) {
    return Boolean(env.GROQ_API_KEY);
  },

  /**
   * @returns {Promise<{content: string, usage: object|null, model: string, provider: string}>}
   */
  async completeJson({
    messages,
    model,
    temperature = 0.1,
    maxOutputTokens = null,
    timeoutMs = 20_000,
    apiKey = process.env.GROQ_API_KEY,
    fetchImpl = globalThis.fetch,
    tools = null,
    toolChoice = "auto",
    responseFormat = { type: "json_object" }
  } = {}) {
    if (!apiKey) {
      throw new AIProviderError("Groq AI service is not configured.", {
        status: 503,
        retryable: false,
        kind: "configuration"
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // gpt-oss is a reasoning model: hidden reasoning tokens share the
      // completion budget, so ask for low effort on structured extraction. Other
      // models reject the parameter, so it is only sent for gpt-oss ids.
      const isReasoningModel = /^openai\/gpt-oss/i.test(String(model ?? ""));

      const response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature,
          ...(isReasoningModel ? { reasoning_effort: "low" } : {}),
          ...(responseFormat ? { response_format: responseFormat } : {}),
          ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {}),
          ...(Array.isArray(tools) && tools.length
            ? { tools, tool_choice: toolChoice, parallel_tool_calls: false }
            : {}),
          messages
        }),
        signal: controller.signal
      });

      const text = await response.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }

      if (!response.ok) {
        const providerMessage =
          data?.error?.message ||
          (typeof data?.error === "string" ? data.error : null) ||
          (text ? text.slice(0, 200) : `Provider HTTP ${response.status}`);

        // A retired model and a revoked key both surface as 4xx, but only the
        // model case is recoverable by configuration (or the configured
        // fallback), so it gets its own kind instead of a generic provider error.
        const providerCode = String(data?.error?.code ?? "");
        const modelNotFound =
          response.status === 404 &&
          (providerCode === "model_not_found" ||
            /does not exist or you do not have access|model_not_found/i.test(String(providerMessage)));

        const toolRelated =
          response.status === 400 &&
          /tool|function_call|response_format/i.test(String(providerMessage));

        const message = modelNotFound
          ? `Groq model "${model}" is unavailable for this key (model_not_found). ` +
            `Set GROQ_MODEL to a model your plan serves, for example "${DEFAULT_MODEL}".`
          : providerMessage;

        throw new AIProviderError(message, {
          status: response.status,
          retryable: !modelNotFound && (response.status === 429 || response.status >= 500),
          retryAfterSeconds: parseRetryAfter(response.headers),
          kind: modelNotFound ? "model-not-found" : toolRelated ? "tools-unsupported" : "provider"
        });
      }

      const choice = data?.choices?.[0];
      const content = choice?.message?.content ?? null;
      const rawToolCalls = Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls : [];

      // A tool-call turn legitimately has no content. Normalise the calls so the
      // agent loop never needs to know Groq's wire format.
      const toolCalls = rawToolCalls
        .map((call) => ({
          id: String(call?.id ?? ""),
          name: String(call?.function?.name ?? ""),
          arguments: String(call?.function?.arguments ?? "{}")
        }))
        .filter((call) => call.name);

      if (!content && toolCalls.length === 0) {
        throw new AIProviderError("Groq returned an empty analysis.", {
          status: 502,
          retryable: true
        });
      }

      const rawUsage = data?.usage || {};

      return {
        content: content ?? "",
        toolCalls,
        finishReason: choice?.finish_reason ?? null,
        provider: "groq",
        model: data?.model || model,
        usage: {
          promptTokens: Number(rawUsage.prompt_tokens) || 0,
          completionTokens: Number(rawUsage.completion_tokens) || 0,
          totalTokens:
            Number(rawUsage.total_tokens) ||
            (Number(rawUsage.prompt_tokens) || 0) + (Number(rawUsage.completion_tokens) || 0)
        }
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new AIProviderError("AI analysis provider timed out.", {
          status: 504,
          retryable: true,
          kind: "timeout"
        });
      }
      if (error instanceof AIProviderError) throw error;
      throw new AIProviderError(
        error instanceof Error ? error.message : "AI provider request failed.",
        { retryable: true, kind: "network", cause: error }
      );
    } finally {
      clearTimeout(timer);
    }
  }
};
