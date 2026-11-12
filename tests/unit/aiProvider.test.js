import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { getAgentConfig, getModelForAgent, getAllAgentConfigs } from "../../server/ai/config.js";
import { aiAgentConfigSchema } from "../../server/ai/config.js";
import { AICompletionError, runAgent, runStructuredCompletion } from "../../server/ai/runAgent.js";
import { AIProviderError, groqProvider } from "../../server/ai/providers/groq.js";
import { getUsageSnapshot, resetUsageForTests } from "../../server/ai/usage.js";
import { agentRunSchema } from "../../shared/schemas/agent.js";

const schema = z.object({ answer: z.string().min(1) });

function withEnv(values, callback) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  return Promise.resolve(callback()).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function stubProvider({ content, error, usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }) {
  return {
    id: "stub",
    label: "Stub",
    isConfigured: () => true,
    async completeJson() {
      if (error) throw error;
      return { content: typeof content === "function" ? content() : content, usage, model: "stub-model", provider: "stub" };
    }
  };
}

const messages = [{ role: "user", content: "hi" }];
const baseConfig = {
  agent: "technical",
  model: "test-model",
  temperature: 0.1,
  maxOutputTokens: null,
  timeoutMs: 5_000,
  retries: 1,
  backoffMs: 10
};

// ------------------------------------------------------------- configuration

test("agent configs are valid, per-agent and environment-driven", () => {
  const technical = getAgentConfig("technical", { env: {} });
  assert.equal(aiAgentConfigSchema.safeParse(technical).success, true);
  assert.equal(technical.agent, "technical");
  assert.equal(technical.temperature, 0.1);

  const chart = getAgentConfig("chart", { env: {} });
  assert.equal(chart.temperature, 0.2, "narrative agents run warmer than interpreters");

  assert.equal(getModelForAgent("technical", { GROQ_MODEL: "global-model" }), "global-model");
  assert.equal(
    getModelForAgent("technical", { GROQ_MODEL: "global-model", AI_MODEL_TECHNICAL: "technical-model" }),
    "technical-model",
    "per-agent model override must win"
  );

  assert.throws(() => getAgentConfig("technical", { overrides: { temperature: 5 } }));
  assert.throws(() => getAgentConfig("technical", { overrides: { retries: 99 } }));
  assert.throws(() => getAgentConfig("marketing"), RangeError);

  assert.equal(getAllAgentConfigs({ env: {} }).length, 6);
});

test("timeouts and retries are configurable through the environment", () => {
  const config = getAgentConfig("risk", {
    env: { AI_TIMEOUT_MS: "8000", AI_RETRIES: "0", AI_BACKOFF_MS: "50" }
  });

  assert.equal(config.timeoutMs, 8000);
  assert.equal(config.retries, 0);
  assert.equal(config.backoffMs, 50);
});

// ----------------------------------------------------------- groq provider

test("groq refuses to run without a key and does not call the network", async () => {
  let called = false;
  await assert.rejects(
    () =>
      groqProvider.completeJson({
        messages,
        model: "m",
        apiKey: "",
        fetchImpl: async () => {
          called = true;
        }
      }),
    (error) => {
      assert.ok(error instanceof AIProviderError);
      assert.equal(error.kind, "configuration");
      assert.equal(error.retryable, false);
      return true;
    }
  );
  assert.equal(called, false);
});

test("groq maps a rate limit to a retryable error with its delay", async () => {
  await assert.rejects(
    () =>
      groqProvider.completeJson({
        messages,
        model: "m",
        apiKey: "k",
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: { message: "rate limited" } }), {
            status: 429,
            headers: { "retry-after": "12" }
          })
      }),
    (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.retryable, true);
      assert.equal(error.retryAfterSeconds, 12);
      return true;
    }
  );
});

test("groq does not retry an authentication failure", async () => {
  await assert.rejects(
    () =>
      groqProvider.completeJson({
        messages,
        model: "m",
        apiKey: "k",
        fetchImpl: async () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 })
      }),
    (error) => {
      assert.equal(error.status, 401);
      assert.equal(error.retryable, false);
      return true;
    }
  );
});

test("groq normalizes a successful response and omits absent max_tokens", async () => {
  let body;
  const result = await groqProvider.completeJson({
    messages,
    model: "requested-model",
    maxOutputTokens: null,
    apiKey: "k",
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return Response.json({
        model: "served-model",
        choices: [{ message: { content: '{"answer":"42"}' } }],
        usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 }
      });
    }
  });

  assert.equal(result.content, '{"answer":"42"}');
  assert.equal(result.model, "served-model");
  assert.deepEqual(result.usage, { promptTokens: 30, completionTokens: 12, totalTokens: 42 });
  assert.equal("max_tokens" in body, false);
  assert.deepEqual(body.response_format, { type: "json_object" });
});

test("groq treats an empty completion as retryable", async () => {
  await assert.rejects(
    () =>
      groqProvider.completeJson({
        messages,
        model: "m",
        apiKey: "k",
        fetchImpl: async () => Response.json({ choices: [{ message: { content: "" } }] })
      }),
    (error) => {
      assert.equal(error.retryable, true);
      return true;
    }
  );
});

test("groq converts a timeout into a retryable timeout error", async () => {
  await assert.rejects(
    () =>
      groqProvider.completeJson({
        messages,
        model: "m",
        apiKey: "k",
        timeoutMs: 10,
        fetchImpl: (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          })
      }),
    (error) => {
      assert.equal(error.kind, "timeout");
      assert.equal(error.retryable, true);
      return true;
    }
  );
});

// ------------------------------------------------- completion runner

test("a valid response is parsed, validated and counted", async () => {
  resetUsageForTests();

  const result = await runStructuredCompletion({
    messages,
    schema,
    config: baseConfig,
    provider: stubProvider({ content: '{"answer":"yes"}' })
  });

  assert.equal(result.output.answer, "yes");
  assert.equal(result.attempts, 1);
  assert.equal(result.provider, "stub");

  const usage = getUsageSnapshot();
  assert.equal(usage.totals.requests, 1);
  assert.equal(usage.totals.totalTokens, 15);
  assert.equal(usage.byAgent.technical.totalTokens, 15);
});

test("schema-invalid output is retried once and then fails", async () => {
  const delays = [];
  let calls = 0;

  await assert.rejects(
    () =>
      runStructuredCompletion({
        messages,
        schema,
        config: { ...baseConfig, retries: 1, backoffMs: 5 },
        provider: stubProvider({ content: () => { calls += 1; return '{"wrong":"shape"}'; } }),
        sleep: async (ms) => { delays.push(ms); }
      }),
    (error) => {
      assert.ok(error instanceof AICompletionError);
      assert.equal(error.attempts, 2);
      assert.match(error.message, /schema/i);
      return true;
    }
  );

  assert.equal(calls, 2, "one retry means two total attempts");
  assert.deepEqual(delays, [5]);
});

test("invalid JSON is treated as a retryable schema failure", async () => {
  await assert.rejects(
    () =>
      runStructuredCompletion({
        messages,
        schema,
        config: { ...baseConfig, retries: 0 },
        provider: stubProvider({ content: "not json" })
      }),
    /not valid JSON/
  );
});

test("non-retryable provider errors fail immediately", async () => {
  const delays = [];

  await assert.rejects(
    () =>
      runStructuredCompletion({
        messages,
        schema,
        config: { ...baseConfig, retries: 2 },
        provider: stubProvider({
          error: new AIProviderError("bad key", { status: 401, retryable: false })
        }),
        sleep: async (ms) => { delays.push(ms); }
      }),
    /bad key/
  );

  assert.deepEqual(delays, []);
});

test("a retryable provider error is retried and succeeds on the second attempt", async () => {
  let calls = 0;
  const provider = {
    id: "flaky",
    isConfigured: () => true,
    async completeJson() {
      calls += 1;
      if (calls === 1) {
        throw new AIProviderError("server error", { status: 503, retryable: true });
      }
      return { content: '{"answer":"second"}', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, model: "m", provider: "flaky" };
    }
  };

  const result = await runStructuredCompletion({
    messages,
    schema,
    config: { ...baseConfig, retries: 1 },
    provider,
    sleep: async () => {}
  });

  assert.equal(result.output.answer, "second");
  assert.equal(result.attempts, 2);
  assert.equal(calls, 2);
});

test("a short retry-after delay is honoured", async () => {
  const delays = [];
  let calls = 0;
  const provider = {
    id: "limited",
    isConfigured: () => true,
    async completeJson() {
      calls += 1;
      if (calls === 1) {
        throw new AIProviderError("slow down", { status: 429, retryable: true, retryAfterSeconds: 2 });
      }
      return { content: '{"answer":"ok"}', usage: null, model: "m", provider: "limited" };
    }
  };

  const result = await runStructuredCompletion({
    messages,
    schema,
    config: { ...baseConfig, retries: 1 },
    provider,
    sleep: async (ms) => { delays.push(ms); }
  });

  assert.deepEqual(delays, [2000]);
  assert.equal(result.attempts, 2);
});

test("a long retry-after fails fast instead of holding the request open", async () => {
  const delays = [];
  let calls = 0;
  const provider = {
    id: "limited",
    isConfigured: () => true,
    async completeJson() {
      calls += 1;
      throw new AIProviderError("rate limited", { status: 429, retryable: true, retryAfterSeconds: 60 });
    }
  };

  await assert.rejects(
    () =>
      runStructuredCompletion({
        messages,
        schema,
        config: { ...baseConfig, retries: 3 },
        provider,
        sleep: async (ms) => { delays.push(ms); }
      }),
    /rate limited/
  );

  assert.equal(calls, 1, "no retry when the provider asks for more than the cap");
  assert.deepEqual(delays, []);
});

test("messages and schema are required", async () => {
  await assert.rejects(() => runStructuredCompletion({ schema, config: baseConfig }), TypeError);
  await assert.rejects(() => runStructuredCompletion({ messages, config: baseConfig }), TypeError);
});

// --------------------------------------------------------------- agent runs

test("runAgent returns a schema-valid completed envelope", async () => {
  resetUsageForTests();

  const run = await runAgent({
    agent: "technical",
    messages,
    schema,
    config: getAgentConfig("technical", { env: {} }),
    provider: stubProvider({ content: '{"answer":"ok"}' }),
    jobId: "research_abcdef12",
    instrumentId: "IN-EQ-RELIANCE"
  });

  assert.equal(agentRunSchema.safeParse(run).success, true);
  assert.equal(run.status, "COMPLETED");
  assert.equal(run.agent, "technical");
  assert.equal(run.output.answer, "ok");
  assert.equal(run.schemaVersion, "1.0.0");
  assert.equal(run.promptVersion, "1.0.0");
});

test("runAgent records failure instead of throwing", async () => {
  const run = await runAgent({
    agent: "news",
    messages,
    schema,
    config: { ...getAgentConfig("news", { env: {} }), retries: 0 },
    provider: stubProvider({ error: new AIProviderError("boom", { status: 500, retryable: false }) })
  });

  assert.equal(agentRunSchema.safeParse(run).success, true);
  assert.equal(run.status, "FAILED");
  assert.match(run.error, /boom/);
  assert.equal(run.output, null);
});

test("runAgent skips a disabled agent", async () => {
  const run = await runAgent({
    agent: "sentiment",
    messages,
    schema,
    config: { ...getAgentConfig("sentiment", { env: {} }), enabled: false },
    provider: stubProvider({ content: '{"answer":"x"}' })
  });

  assert.equal(agentRunSchema.safeParse(run).success, true);
  assert.equal(run.status, "SKIPPED");
  assert.match(run.error, /disabled/);
});

test("usage is aggregated per agent and per model", async () => {
  resetUsageForTests();

  const provider = stubProvider({
    content: '{"answer":"ok"}',
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
  });

  await runStructuredCompletion({ messages, schema, config: { ...baseConfig, agent: "chart" }, provider });
  await runStructuredCompletion({ messages, schema, config: { ...baseConfig, agent: "chart" }, provider });
  await runStructuredCompletion({ messages, schema, config: { ...baseConfig, agent: "risk" }, provider });

  const usage = getUsageSnapshot();
  assert.equal(usage.totals.requests, 3);
  assert.equal(usage.totals.totalTokens, 450);
  assert.equal(usage.byAgent.chart.requests, 2);
  assert.equal(usage.byAgent.risk.totalTokens, 150);
  assert.equal(usage.byModel["stub-model"].requests, 3);
});
