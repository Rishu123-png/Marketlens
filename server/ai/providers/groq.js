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
    fetchImpl = globalThis.fetch
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
      const response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature,
          response_format: { type: "json_object" },
          ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {}),
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
        const message =
          data?.error?.message ||
          (typeof data?.error === "string" ? data.error : null) ||
          (text ? text.slice(0, 200) : `Provider HTTP ${response.status}`);

        throw new AIProviderError(message, {
          status: response.status,
          retryable: response.status === 429 || response.status >= 500,
          retryAfterSeconds: parseRetryAfter(response.headers)
        });
      }

      const content = data?.choices?.[0]?.message?.content;

      if (!content) {
        throw new AIProviderError("Groq returned an empty analysis.", {
          status: 502,
          retryable: true
        });
      }

      const rawUsage = data?.usage || {};

      return {
        content,
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
