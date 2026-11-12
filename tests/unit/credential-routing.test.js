import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { runAgent } from "../../server/ai/runAgent.js";
import { getAgentConfig } from "../../server/ai/config.js";
import { groqProvider } from "../../server/ai/providers/groq.js";
import {
  GROQ_AGENT_KEY_ENV,
  describeGroqCredentials,
  getGroqCredential,
  GroqCredentialError
} from "../../server/ai/credentials.js";
import { agentTelemetrySnapshot, resetAgentTelemetryForTests } from "../../server/ai/telemetry.js";
import { resetUsageForTests } from "../../server/ai/usage.js";
import diagnosticsHandler from "../../handlers/diagnostics.js";
import providerStatusHandler from "../../handlers/provider-status.js";
import { resetRateLimitsForTests } from "../../lib/server/rateLimit.js";
import { resetObservationsForTests } from "../../server/market-data/observations.js";

const AGENTS = ["chart", "technical", "news", "sentiment", "risk", "coordinator"];
const schema = z.object({ answer: z.string().min(1) });
const messages = [{ role: "user", content: "Return JSON." }];

const SECRETS = Object.fromEntries(
  AGENTS.map((agent) => [agent, `secret-${agent}-do-not-print`])
);
const SHARED_SECRET = "secret-shared-do-not-print";

const CREDENTIAL_VARIABLES = [...Object.values(GROQ_AGENT_KEY_ENV), "GROQ_API_KEY", "GROQ_AGENT_KEYS_REQUIRED"];

function withEnvironment(values, callback) {
  const previous = Object.fromEntries(CREDENTIAL_VARIABLES.map((key) => [key, process.env[key]]));
  for (const key of CREDENTIAL_VARIABLES) delete process.env[key];
  Object.assign(process.env, values);
  return Promise.resolve(callback()).finally(() => {
    for (const key of CREDENTIAL_VARIABLES) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

function allDedicated() {
  return Object.fromEntries(AGENTS.map((agent) => [GROQ_AGENT_KEY_ENV[agent], SECRETS[agent]]));
}

function mockGroq({ status = 200, rateLimitHeaders = {} } = {}) {
  const requests = [];
  const fetchImpl = async (_url, options) => {
    requests.push({
      authorization: options.headers?.Authorization ?? null,
      body: JSON.parse(options.body)
    });
    if (status !== 200) {
      return new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status,
        headers: { "retry-after": "7", ...rateLimitHeaders }
      });
    }
    return Response.json(
      {
        choices: [{ message: { content: JSON.stringify({ answer: `${requests.length}` }) } }],
        usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 },
        model: "openai/gpt-oss-120b"
      },
      { headers: rateLimitHeaders }
    );
  };
  return { fetchImpl, requests };
}

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

test("the credential map uses the six exact per-agent variable names", () => {
  assert.deepEqual(GROQ_AGENT_KEY_ENV, {
    chart: "GROQ_API_KEY_CHART",
    technical: "GROQ_API_KEY_TECHNICAL",
    news: "GROQ_API_KEY_NEWS",
    sentiment: "GROQ_API_KEY_SENTIMENT",
    risk: "GROQ_API_KEY_RISK",
    coordinator: "GROQ_API_KEY_COORDINATOR"
  });
});

test("each of the six agents uses its own credential in the actual Groq adapter", async () => {
  resetUsageForTests();
  resetAgentTelemetryForTests();

  await withEnvironment(allDedicated(), async () => {
    for (const agent of AGENTS) {
      const { fetchImpl, requests } = mockGroq();
      const run = await runAgent({
        agent,
        messages,
        schema,
        config: getAgentConfig(agent, { env: process.env }),
        provider: groqProvider,
        fetchImpl
      });

      assert.equal(run.status, "COMPLETED", `${agent} should complete`);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].authorization, `Bearer ${SECRETS[agent]}`, `${agent} must use its own key`);
      for (const other of AGENTS.filter((id) => id !== agent)) {
        assert.notEqual(requests[0].authorization, `Bearer ${SECRETS[other]}`, `${agent} used ${other}'s key`);
      }
      assert.equal(run.credentialEnvName, GROQ_AGENT_KEY_ENV[agent]);
      assert.equal(run.credentialMode, "dedicated");
      assert.equal(run.requestCount, 1);
      assert.equal(run.httpStatus, 200);
      assert.equal(run.usage.totalTokens, 15);
      assert.equal(run.provider, "groq");

      const stored = JSON.stringify(run);
      for (const secret of [...Object.values(SECRETS), SHARED_SECRET]) {
        assert.equal(stored.includes(secret), false, "run metadata must not contain a credential value");
      }
    }
  });
});

test("shared fallback is used only when permitted and no dedicated key exists", async () => {
  await withEnvironment({ GROQ_API_KEY: SHARED_SECRET }, async () => {
    const { fetchImpl, requests } = mockGroq();
    const run = await runAgent({
      agent: "chart",
      messages,
      schema,
      config: getAgentConfig("chart", { env: process.env }),
      provider: groqProvider,
      fetchImpl
    });

    assert.equal(run.status, "COMPLETED");
    assert.equal(requests[0].authorization, `Bearer ${SHARED_SECRET}`);
    assert.equal(run.credentialEnvName, "GROQ_API_KEY");
    assert.equal(run.credentialMode, "shared");
  });
});

test("strict mode fails a missing dedicated key without falling back or calling the network", async () => {
  await withEnvironment(
    {
      GROQ_API_KEY: SHARED_SECRET,
      GROQ_API_KEY_TECHNICAL: SECRETS.technical,
      GROQ_AGENT_KEYS_REQUIRED: "true"
    },
    async () => {
      const { fetchImpl, requests } = mockGroq();
      const run = await runAgent({
        agent: "chart",
        messages,
        schema,
        config: getAgentConfig("chart", { env: process.env }),
        provider: groqProvider,
        fetchImpl
      });

      assert.equal(run.status, "FAILED");
      assert.equal(run.credentialEnvName, "GROQ_API_KEY_CHART");
      assert.equal(run.credentialMode, "none");
      assert.equal(run.requestCount, 0);
      assert.match(run.error, /GROQ_API_KEY_CHART/);
      assert.match(run.error, /GROQ_AGENT_KEYS_REQUIRED/);
      assert.equal(requests.length, 0, "strict mode must not make a shared-key request");

      const allowed = await runAgent({
        agent: "technical",
        messages,
        schema,
        config: getAgentConfig("technical", { env: process.env }),
        provider: groqProvider,
        fetchImpl
      });
      assert.equal(allowed.status, "COMPLETED");
      assert.equal(requests[0].authorization, `Bearer ${SECRETS.technical}`);
    }
  );
});

test("missing credentials fail clearly and expose only environment-variable names", async () => {
  await withEnvironment({}, async () => {
    const run = await runAgent({
      agent: "risk",
      messages,
      schema,
      config: getAgentConfig("risk", { env: process.env }),
      provider: groqProvider,
      fetchImpl: async () => {
        throw new Error("network must not be called");
      }
    });

    assert.equal(run.status, "FAILED");
    assert.equal(run.credentialMode, "none");
    assert.match(run.error, /GROQ_API_KEY_RISK/);
    assert.match(run.error, /GROQ_API_KEY/);
  });
});

test("rate-limit status and safe header metadata are recorded without secrets", async () => {
  await withEnvironment(allDedicated(), async () => {
    const { fetchImpl } = mockGroq({
      status: 429,
      rateLimitHeaders: {
        "x-ratelimit-remaining-requests": "0",
        "x-ratelimit-remaining-tokens": "12",
        "x-ratelimit-reset-requests": "7s"
      }
    });
    const run = await runAgent({
      agent: "news",
      messages,
      schema,
      config: { ...getAgentConfig("news", { env: process.env }), retries: 0 },
      provider: groqProvider,
      fetchImpl
    });

    assert.equal(run.status, "FAILED");
    assert.equal(run.httpStatus, 429);
    assert.equal(run.requestCount, 1);
    assert.equal(run.rateLimit.remainingRequests, 0);
    assert.equal(run.rateLimit.remainingTokens, 12);
    assert.equal(run.rateLimit.resetRequests, "7s");
    assert.match(run.error, /rate limited/);
    assert.equal(JSON.stringify(run).includes(SECRETS.news), false);
  });
});

test("status and diagnostics endpoints report credential presence without values", async () => {
  resetRateLimitsForTests();
  resetObservationsForTests();
  await withEnvironment(allDedicated(), async () => {
    const statusRes = mockResponse();
    providerStatusHandler({ query: {}, headers: {} }, statusRes);

    assert.equal(statusRes.statusCode, 200);
    assert.equal(statusRes.body.ai.groq.configured, true);
    assert.equal(statusRes.body.ai.groq.credentials.dedicatedConfigured, 6);
    assert.equal(statusRes.body.ai.groq.credentials.agents.chart.selected, "dedicated");
    assert.equal(statusRes.body.ai.groq.credentials.agents.chart.envName, "GROQ_API_KEY_CHART");
    assert.equal(statusRes.body.ai.groq.credentials.sharedFallback.configured, false);

    const diagRes = mockResponse();
    await diagnosticsHandler({ query: {}, headers: {} }, diagRes);
    assert.equal(diagRes.statusCode, 200);
    assert.equal(diagRes.body.ai.credentials.agents.chart.mode, "dedicated");
    assert.equal(diagRes.body.security.secretsExposed, false);
    assert.ok(diagRes.body.market, "market diagnostics must be a separate panel");

    const serialized = JSON.stringify({ status: statusRes.body, diagnostics: diagRes.body });
    for (const secret of [...Object.values(SECRETS), SHARED_SECRET]) {
      assert.equal(serialized.includes(secret), false, "status/diagnostics must never expose a key value");
    }
  });
});

test("telemetry never stores a credential value", async () => {
  resetAgentTelemetryForTests();
  await withEnvironment(allDedicated(), async () => {
    for (const agent of AGENTS) {
      await runAgent({
        agent,
        messages,
        schema,
        config: getAgentConfig(agent, { env: process.env }),
        provider: groqProvider,
        fetchImpl: mockGroq().fetchImpl
      });
    }
    const snapshot = agentTelemetrySnapshot();
    assert.equal(snapshot.runs.length, 6);
    const serialized = JSON.stringify(snapshot);
    for (const secret of Object.values(SECRETS)) assert.equal(serialized.includes(secret), false);
  });
});

test("resolver reports the selected variable name and fails closed", () => {
  assert.equal(getGroqCredential("chart", { env: allDedicated() }).envName, "GROQ_API_KEY_CHART");
  assert.equal(getGroqCredential("chart", { env: { GROQ_API_KEY: SHARED_SECRET } }).mode, "shared");
  assert.throws(
    () => getGroqCredential("chart", { env: { GROQ_API_KEY: SHARED_SECRET }, allowShared: false }),
    (error) => error instanceof GroqCredentialError && error.envName === "GROQ_API_KEY_CHART"
  );

  const status = describeGroqCredentials({ ...allDedicated(), GROQ_API_KEY: SHARED_SECRET });
  assert.equal(status.sharedFallback.configured, true);
  assert.equal(status.agents.chart.mode, "dedicated");
  assert.equal(JSON.stringify(status).includes(SECRETS.chart), false);
});

test("credentials never appear in console output during a routed call", async () => {
  await withEnvironment(allDedicated(), async () => {
    const captured = [];
    const original = { log: console.log, error: console.error, warn: console.warn };
    console.log = (...args) => captured.push(args.join(" "));
    console.error = (...args) => captured.push(args.join(" "));
    console.warn = (...args) => captured.push(args.join(" "));
    try {
      await runAgent({
        agent: "coordinator",
        messages,
        schema,
        config: getAgentConfig("coordinator", { env: process.env }),
        provider: groqProvider,
        fetchImpl: mockGroq().fetchImpl
      });
    } finally {
      console.log = original.log;
      console.error = original.error;
      console.warn = original.warn;
    }

    const output = captured.join("\n");
    for (const secret of [...Object.values(SECRETS), SHARED_SECRET]) {
      assert.equal(output.includes(secret), false, "logs must not contain credential values");
    }
  });
});

test("an upstream error that echoes a key is redacted before it reaches telemetry", async () => {
  await withEnvironment(allDedicated(), async () => {
    const leaked = `invalid key ${SECRETS.chart}`;
    const run = await runAgent({
      agent: "chart",
      messages,
      schema,
      config: { ...getAgentConfig("chart", { env: process.env }), retries: 0 },
      provider: groqProvider,
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { message: leaked } }), { status: 401 })
    });

    assert.equal(run.status, "FAILED");
    assert.equal(run.error.includes(SECRETS.chart), false);
    assert.match(run.error, /\[redacted\]/);
    assert.equal(JSON.stringify(agentTelemetrySnapshot()).includes(SECRETS.chart), false);
  });
});
