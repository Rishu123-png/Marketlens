import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { readFileSync } from "node:fs";

import {
  MAX_TOOL_CALLS_PER_RUN,
  TOOL_NAMES,
  createToolContext,
  executeToolCall,
  toolDefinitionsFor
} from "../../server/agents/tools.js";
import { runStructuredCompletion } from "../../server/ai/runAgent.js";
import { toolAgentIds, toolCallingEnabled, toolsForAgent } from "../../server/ai/toolPolicy.js";

const envelope = {
  marketContext: {
    recentCandles: [
      { time: "2026-01-01", open: 100, high: 102, low: 99, close: 101, volume: 1000 },
      { time: "2026-01-02", open: 101, high: 104, low: 100, close: 103, volume: 1200 }
    ],
    candles: { count: 2, interval: "1day" }
  },
  technical: { rsi: { value: 58.2 }, macd: { histogram: -0.4 }, candles: 2 },
  evidence: {
    items: [
      { evidenceId: "ev-1", publisher: "RBI", sourceType: "news", excerpt: "Policy repo rate held at 5.5 percent", publishedAt: "2026-01-02T00:00:00.000Z" },
      { evidenceId: "ev-2", publisher: "SEBI", sourceType: "filing", excerpt: "Circular on disclosure timelines", publishedAt: "2026-01-01T00:00:00.000Z" }
    ]
  }
};

const context = createToolContext(envelope);

test("tool definitions expose only deterministic read tools", () => {
  assert.deepEqual([...TOOL_NAMES].sort(), [
    "get_company_news",
    "get_historical_candles",
    "get_instrument_info",
    "get_market_events",
    "get_market_overview",
    "get_quote",
    "get_technical_indicators",
    "read_candles",
    "read_evidence",
    "read_indicator",
    "search_evidence"
  ]);
  for (const definition of toolDefinitionsFor()) {
    assert.equal(definition.type, "function");
    assert.equal(definition.function.parameters.type, "object");
  }
  assert.equal(toolDefinitionsFor(["read_candles"]).length, 1);

  const source = readFileSync(new URL("../../server/agents/tools.js", import.meta.url), "utf8");
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(withoutComments, /\bfetch\s*\(/);
  assert.doesNotMatch(withoutComments, /from\s+"node:https?"/);
  assert.doesNotMatch(withoutComments, /process\.env/);
});

test("read_candles returns only supplied candles and respects the limit", () => {
  const full = executeToolCall({ name: "read_candles", arguments: "{}" }, context);
  assert.equal(full.ok, true);
  assert.equal(JSON.parse(full.content).candles.length, 2);

  const limited = executeToolCall({ name: "read_candles", arguments: '{"limit":1}' }, context);
  assert.deepEqual(JSON.parse(limited.content).candles, [envelope.marketContext.recentCandles[1]]);

  const empty = executeToolCall({ name: "read_candles" }, createToolContext({}));
  assert.deepEqual(JSON.parse(empty.content).candles, []);
  assert.match(JSON.parse(empty.content).note, /No candles/);
});

test("read_indicator returns calculated values or names what is available", () => {
  const known = executeToolCall({ name: "read_indicator", arguments: '{"name":"rsi"}' }, context);
  assert.equal(known.ok, true);
  assert.deepEqual(JSON.parse(known.content).value, { value: 58.2 });

  const unknown = executeToolCall({ name: "read_indicator", arguments: '{"name":"magic"}' }, context);
  assert.equal(unknown.ok, true);
  const payload = JSON.parse(unknown.content);
  assert.equal(payload.value, null);
  assert.ok(payload.available.includes("rsi"));

  const missing = executeToolCall({ name: "read_indicator", arguments: '{"name":"rsi"}' }, createToolContext({}));
  assert.equal(JSON.parse(missing.content).value, null);
});

test("evidence tools only read the run envelope", () => {
  const search = executeToolCall({ name: "search_evidence", arguments: '{"terms":"repo rate"}' }, context);
  const matches = JSON.parse(search.content).matches;
  assert.equal(matches.length, 1);
  assert.equal(matches[0].evidenceId, "ev-1");

  const none = executeToolCall({ name: "search_evidence", arguments: '{"terms":"acquisition"}' }, context);
  assert.deepEqual(JSON.parse(none.content).matches, []);
  assert.match(JSON.parse(none.content).note, /nothing new was fetched/);

  const found = executeToolCall({ name: "read_evidence", arguments: '{"evidenceId":"ev-2"}' }, context);
  assert.equal(JSON.parse(found.content).found, true);
  assert.equal(JSON.parse(found.content).evidence.publisher, "SEBI");

  const absent = executeToolCall({ name: "read_evidence", arguments: '{"evidenceId":"ev-x"}' }, context);
  assert.equal(JSON.parse(absent.content).found, false);
  assert.match(JSON.parse(absent.content).note, /Do not cite/);
});

test("unknown tools, bad arguments and exhausted budgets fail safely", () => {
  const unknown = executeToolCall({ name: "fetch_url", arguments: "{}" }, context);
  assert.equal(unknown.ok, false);
  assert.match(JSON.parse(unknown.content).error, /not available/);

  const badJson = executeToolCall({ name: "read_candles", arguments: "{not json" }, context);
  assert.equal(badJson.ok, false);

  const badArgs = executeToolCall({ name: "read_candles", arguments: '{"limit":9999}' }, context);
  assert.equal(badArgs.ok, false);

  const budget = { used: MAX_TOOL_CALLS_PER_RUN };
  const exhausted = executeToolCall({ name: "read_candles", arguments: "{}" }, context, budget);
  assert.equal(exhausted.ok, false);
  assert.match(JSON.parse(exhausted.content).error, /budget exhausted/i);
});

function stubProvider(steps) {
  let index = 0;
  return {
    id: "stub",
    calls: [],
    async completeJson(request) {
      this.calls.push(request);
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      return typeof step === "function" ? step(request) : step;
    }
  };
}

test("agent loop executes tool calls and returns validated JSON with summed usage", async () => {
  const provider = stubProvider([
    {
      content: "",
      toolCalls: [{ id: "call-1", name: "read_indicator", arguments: '{"name":"rsi"}' }],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      model: "stub-1",
      provider: "stub"
    },
    {
      content: JSON.stringify({ summary: "RSI 58.2" }),
      toolCalls: [],
      usage: { promptTokens: 20, completionTokens: 8, totalTokens: 28 },
      model: "stub-1",
      provider: "stub"
    }
  ]);

  const result = await runStructuredCompletion({
    messages: [{ role: "system", content: "Return JSON." }],
    schema: z.object({ summary: z.string() }),
    config: { model: "stub-1", retries: 0, agent: "chart" },
    provider,
    tools: toolDefinitionsFor(["read_indicator"]),
    toolContext: context
  });

  assert.deepEqual(result.output, { summary: "RSI 58.2" });
  assert.equal(result.toolRounds, 1);
  assert.deepEqual(result.toolCalls, [{ name: "read_indicator", ok: true }]);
  assert.deepEqual(result.usage, { promptTokens: 30, completionTokens: 13, totalTokens: 43 });

  const followUp = provider.calls[1].messages;
  assert.equal(followUp[1].role, "assistant");
  assert.equal(followUp[1].tool_calls[0].function.name, "read_indicator");
  assert.equal(followUp[2].role, "tool");
  assert.equal(followUp[2].tool_call_id, "call-1");
  assert.match(followUp[2].content, /58\.2/);

  // Tools stay available while rounds remain; they are withheld only once the
  // tool-round budget is spent (covered by the max-rounds test below).
  assert.equal(provider.calls[0].tools.length, 1);
  assert.equal(provider.calls[1].tools.length, 1);
});

test("agent loop falls back to a tool-free call when the model rejects tools", async () => {
  const { AIProviderError } = await import("../../server/ai/providers/groq.js");
  const provider = stubProvider([
    (request) => {
      if (request.tools) {
        throw new AIProviderError("tool_choice is not supported for this model", {
          status: 400,
          retryable: false,
          kind: "tools-unsupported"
        });
      }
      return {
        content: JSON.stringify({ ok: true }),
        toolCalls: [],
        usage: { total_tokens: 7 },
        model: "stub-1",
        provider: "stub"
      };
    }
  ]);

  const result = await runStructuredCompletion({
    messages: [{ role: "user", content: "analyse" }],
    schema: z.object({ ok: z.boolean() }),
    config: { model: "stub-1", retries: 0, agent: "news" },
    provider,
    tools: toolDefinitionsFor(["search_evidence"]),
    toolContext: context
  });

  assert.deepEqual(result.output, { ok: true });
  assert.equal(result.toolsDisabled, true);
  assert.equal(result.toolRounds, 0);
});

test("agent loop stops offering tools after the maximum number of rounds", async () => {
  const toolTurn = {
    content: "",
    toolCalls: [{ id: "c", name: "read_candles", arguments: "{}" }],
    usage: { total_tokens: 1 },
    model: "stub-1",
    provider: "stub"
  };
  const provider = stubProvider([
    toolTurn,
    toolTurn,
    {
      content: JSON.stringify({ done: true }),
      toolCalls: [],
      usage: { total_tokens: 1 },
      model: "stub-1",
      provider: "stub"
    }
  ]);

  const result = await runStructuredCompletion({
    messages: [{ role: "user", content: "analyse" }],
    schema: z.object({ done: z.boolean() }),
    config: { model: "stub-1", retries: 0, agent: "chart" },
    provider,
    tools: toolDefinitionsFor(["read_candles"]),
    toolContext: context,
    maxToolRounds: 2
  });

  assert.equal(result.output.done, true);
  assert.equal(result.toolRounds, 2);
  assert.equal(provider.calls.length, 3);
  assert.ok(provider.calls[0].tools);
  assert.ok(provider.calls[1].tools);
  assert.ok(!provider.calls[2].tools);
});

test("tool policy is per-agent and can be switched off", () => {
  assert.equal(toolCallingEnabled({}), true);
  assert.equal(toolCallingEnabled({ AI_TOOL_CALLING: "off" }), false);
  assert.deepEqual(toolAgentIds({}), ["chart", "news", "sentiment"]);
  assert.deepEqual(toolAgentIds({ AI_TOOL_AGENTS: "news, risk,bogus" }), ["news", "risk"]);

  const chart = toolsForAgent("chart", envelope, {});
  assert.deepEqual(chart.tools.map((tool) => tool.function.name).sort(), [
    "get_historical_candles",
    "get_instrument_info",
    "get_quote"
  ]);
  assert.equal(chart.context.candles.length, 2);

  assert.deepEqual(toolsForAgent("technical", envelope, {}), { tools: null, context: null });
  assert.deepEqual(toolsForAgent("coordinator", envelope, {}), { tools: null, context: null });
  assert.deepEqual(toolsForAgent("chart", envelope, { AI_TOOL_CALLING: "off" }), { tools: null, context: null });
});


test("the controlled get_* tools read only the supplied envelope", () => {
  const quote = executeToolCall({ name: "get_quote", arguments: "{}" }, context);
  assert.equal(quote.ok, true);
  assert.equal(JSON.parse(quote.content).quote, null, "the fixture intentionally has no quote");

  const info = executeToolCall({ name: "get_instrument_info", arguments: "{}" }, context);
  assert.equal(info.ok, true);

  const indicators = executeToolCall(
    { name: "get_technical_indicators", arguments: '{"names":["rsi","magic"]}' },
    context
  );
  const indicatorPayload = JSON.parse(indicators.content);
  assert.deepEqual(indicatorPayload.indicators.rsi, { value: 58.2 });
  assert.deepEqual(indicatorPayload.missing, ["magic"]);

  const news = executeToolCall({ name: "get_company_news", arguments: '{"terms":"policy"}' }, context);
  assert.equal(JSON.parse(news.content).matches.length, 1);

  const events = executeToolCall({ name: "get_market_events", arguments: "{}" }, context);
  assert.equal(JSON.parse(events.content).matches.length, 1);
  assert.equal(JSON.parse(events.content).matches[0].publisher, "SEBI");

  const overview = executeToolCall({ name: "get_market_overview", arguments: "{}" }, context);
  const overviewPayload = JSON.parse(overview.content);
  assert.equal(overviewPayload.candles.count, 2);
  assert.match(overviewPayload.note, /not a forecast/i);

  const candles = executeToolCall({ name: "get_historical_candles", arguments: '{"limit":1}' }, context);
  assert.equal(JSON.parse(candles.content).candles.length, 1);
});
