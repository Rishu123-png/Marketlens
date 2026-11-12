import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { AGENT_IDS } from "../../shared/schemas/agent.js";
import { AI_PROVIDER_IDS, getAgentConfig } from "../../server/ai/config.js";
import { toolAgentIds, toolsForAgent } from "../../server/ai/toolPolicy.js";
import { buildEvidenceEnvelope } from "../../server/agents/envelope.js";

test("Groq is the only AI provider id and every agent resolves to it", () => {
  assert.deepEqual([...AI_PROVIDER_IDS], ["groq"]);

  for (const agent of AGENT_IDS) {
    const config = getAgentConfig(agent);
    assert.equal(config.provider, "groq", `${agent} must run on Groq`);
    assert.ok(config.model, `${agent} must resolve a model`);
  }

  const overridden = getAgentConfig("news", { overrides: { model: "custom-model" } });
  assert.equal(overridden.provider, "groq");
  assert.equal(overridden.model, "custom-model");
});

test("no second AI provider module exists", () => {
  const providers = readdirSync(new URL("../../server/ai/providers", import.meta.url));
  assert.deepEqual(providers.filter((file) => file.endsWith(".js")), ["groq.js"]);
});

test("deterministic evidence adapters never import the AI layer", () => {
  const files = [
    "../../server/evidence/coverage.js",
    "../../server/evidence/registry.js",
    "../../server/evidence/secEdgar.js",
    "../../server/evidence/amfiNav.js",
    "../../server/evidence/dataGovIn.js",
    "../../server/news/feeds.js"
  ];

  for (const relative of files) {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.doesNotMatch(source, /server\/ai\//, `${relative} must not depend on the AI layer`);
    assert.doesNotMatch(source, /groq/i, `${relative} must not reference Groq`);
  }
});

test("tool policy defaults to three analytical agents and no coordinator", () => {
  assert.deepEqual(toolAgentIds({}), ["chart", "news", "sentiment"]);
  assert.ok(!toolAgentIds({}).includes("coordinator"));

  const envelope = { marketContext: { recentCandles: [] }, technical: null, evidence: { items: [] } };
  const coordinator = toolsForAgent("coordinator", envelope, {});
  assert.equal(coordinator.tools, null);
});

test("coverage summary travels inside the agent evidence envelope", () => {
  const coverage = {
    version: "1.0.0",
    degraded: true,
    capabilities: { candles: { status: "unavailable", delayed: false, liveVerification: "not-applicable" } },
    limitations: ["Historical candles unavailable: No usable source."]
  };

  const envelope = buildEvidenceEnvelope({
    instrument: { id: "IN-EQ-RELIANCE", symbol: "RELIANCE", exchange: "NSE" },
    depth: "quick",
    quality: { dataWarnings: [], coverage }
  });

  assert.deepEqual(envelope.quality.coverage, coverage);
  assert.equal(envelope.quality.dataWarnings.length, 0);

  const withoutCoverage = buildEvidenceEnvelope({
    instrument: { id: "IN-EQ-RELIANCE", symbol: "RELIANCE", exchange: "NSE" },
    depth: "quick"
  });
  assert.equal(withoutCoverage.quality.coverage, null);
});
