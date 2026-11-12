/**
 * Deterministic tools for Groq tool calling.
 *
 * Groq is the only AI provider in Market Lens, and it is never allowed to fetch
 * market data itself. These tools are *reads over the evidence envelope already
 * assembled by deterministic code for this run*. Executing a tool cannot cause a
 * new provider request, cannot widen the evidence set, and cannot invent a
 * number: if a value is not in the envelope, the tool says so.
 *
 * Unknown tool names are rejected, arguments are validated, and every run has a
 * hard call budget so a model cannot loop on tools indefinitely.
 */

import { z } from "zod";

export const MAX_TOOL_CALLS_PER_RUN = 6;
export const MAX_TOOL_OUTPUT_CHARS = 12_000;

const readCandlesSchema = z.object({
  limit: z.number().int().min(1).max(30).optional()
});

const readIndicatorSchema = z.object({
  name: z.string().min(1).max(40)
});

const searchEvidenceSchema = z.object({
  terms: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(10).optional()
});

const readEvidenceSchema = z.object({
  evidenceId: z.string().min(1).max(64)
});

/** Tool definitions sent to Groq (OpenAI-compatible JSON schema). */
export const TOOL_DEFINITIONS = Object.freeze([
  {
    type: "function",
    function: {
      name: "read_candles",
      description:
        "Read the most recent OHLCV candles already supplied for this instrument. Read-only; returns no new data.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 30, description: "How many recent candles to return." }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_indicator",
      description:
        "Read one calculated indicator value (for example rsi, macd, atr, bollinger, relativeVolume, movingAverages). Values are computed in application code.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Indicator key such as rsi, macd, atr, bollinger, relativeVolume, movingAverages, lastClose, candles."
          }
        },
        required: ["name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_evidence",
      description:
        "Search the already-retrieved news and filing evidence for this run by keyword. Read-only; never fetches new sources.",
      parameters: {
        type: "object",
        properties: {
          terms: { type: "string", description: "Keyword or phrase to match in the excerpt or publisher." },
          limit: { type: "integer", minimum: 1, maximum: 10 }
        },
        required: ["terms"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_evidence",
      description: "Read one evidence item by id, including its publisher, timestamps, url and flags.",
      parameters: {
        type: "object",
        properties: {
          evidenceId: { type: "string", description: "The evidenceId shown in the envelope." }
        },
        required: ["evidenceId"]
      }
    }
  }
]);

const TOOL_NAMES = TOOL_DEFINITIONS.map((tool) => tool.function.name);

export function toolDefinitionsFor(names = TOOL_NAMES) {
  const allowed = new Set(names);
  return TOOL_DEFINITIONS.filter((tool) => allowed.has(tool.function.name));
}

/** Everything a tool may read: built from the envelope, never from a network call. */
export function createToolContext(envelope = {}) {
  return {
    candles: envelope.marketContext?.recentCandles ?? [],
    candleCount: envelope.marketContext?.candles?.count ?? 0,
    interval: envelope.marketContext?.candles?.interval ?? null,
    indicators: envelope.technical ?? null,
    evidence: envelope.evidence?.items ?? []
  };
}

function truncate(text, max = 1_500) {
  const value = typeof text === "string" ? text : JSON.stringify(text);
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function describeError(error) {
  return {
    ok: false,
    content: JSON.stringify({ error: error.issues?.[0]?.message || "Invalid arguments for this tool." })
  };
}

function runReadCandles(args, context) {
  const parsed = readCandlesSchema.safeParse(args ?? {});
  if (!parsed.success) return describeError(parsed.error);

  const available = context.candles;
  if (!available.length) {
    return { ok: true, content: JSON.stringify({ candles: [], note: "No candles were supplied for this run." }) };
  }

  const limit = Math.min(parsed.data.limit ?? 15, available.length);
  return {
    ok: true,
    content: JSON.stringify({
      interval: context.interval,
      totalSupplied: available.length,
      candles: available.slice(-limit)
    })
  };
}

function runReadIndicator(args, context) {
  const parsed = readIndicatorSchema.safeParse(args ?? {});
  if (!parsed.success) return describeError(parsed.error);

  const indicators = context.indicators;
  if (!indicators) {
    return { ok: true, content: JSON.stringify({ value: null, note: "No indicator snapshot was calculated for this run." }) };
  }

  const key = parsed.data.name.trim();
  if (!Object.hasOwn(indicators, key)) {
    return {
      ok: true,
      content: JSON.stringify({
        value: null,
        note: `Indicator "${key}" is not available.`,
        available: Object.keys(indicators)
      })
    };
  }

  return { ok: true, content: JSON.stringify({ name: key, value: indicators[key], candles: indicators.candles ?? null }) };
}

function runSearchEvidence(args, context) {
  const parsed = searchEvidenceSchema.safeParse(args ?? {});
  if (!parsed.success) return describeError(parsed.error);

  const terms = String(parsed.data.terms ?? "").toLowerCase().trim();
  const limit = parsed.data.limit ?? 5;

  const matches = context.evidence
    .filter((item) => {
      if (!terms) return true;
      return `${item.excerpt ?? ""} ${item.publisher ?? ""} ${item.sourceType ?? ""}`.toLowerCase().includes(terms);
    })
    .slice(0, limit)
    .map((item) => ({
      evidenceId: item.evidenceId,
      publisher: item.publisher,
      sourceType: item.sourceType,
      publishedAt: item.publishedAt,
      excerpt: truncate(item.excerpt ?? "", 400),
      verification: item.verification,
      duplicateCount: item.duplicateCount ?? 1,
      injectionSignals: item.injectionSignals ?? []
    }));

  return {
    ok: true,
    content: JSON.stringify({
      matches,
      searched: context.evidence.length,
      note: matches.length ? undefined : "No supplied evidence matched those terms; nothing new was fetched."
    })
  };
}

function runReadEvidence(args, context) {
  const parsed = readEvidenceSchema.safeParse(args ?? {});
  if (!parsed.success) return describeError(parsed.error);

  const item = context.evidence.find((entry) => entry.evidenceId === parsed.data.evidenceId);
  if (!item) {
    return {
      ok: true,
      content: JSON.stringify({
        found: false,
        note: "That evidenceId is not part of this run. Do not cite it."
      })
    };
  }

  return {
    ok: true,
    content: JSON.stringify({
      found: true,
      evidence: {
        ...item,
        excerpt: truncate(item.excerpt ?? "", 1_200)
      }
    })
  };
}

const IMPLEMENTATIONS = {
  read_candles: runReadCandles,
  read_indicator: runReadIndicator,
  search_evidence: runSearchEvidence,
  read_evidence: runReadEvidence
};

/**
 * Execute one tool call.
 *
 * @param {{name:string, arguments?:string}} call
 * @param {object} context From `createToolContext`.
 * @param {{used?:number}} [budget] Mutated call counter.
 */
export function executeToolCall(call, context, budget = { used: 0 }) {
  const name = String(call?.name ?? "");
  const used = budget.used ?? 0;

  if (used >= MAX_TOOL_CALLS_PER_RUN) {
    return {
      name,
      ok: false,
      content: JSON.stringify({ error: "Tool budget exhausted for this run. Answer with the evidence you already have." })
    };
  }

  budget.used = used + 1;

  const implementation = IMPLEMENTATIONS[name];
  if (!implementation) {
    return {
      name,
      ok: false,
      content: JSON.stringify({ error: `Tool "${name}" is not available.`, available: TOOL_NAMES })
    };
  }

  let args = {};
  try {
    args = typeof call.arguments === "string" ? JSON.parse(call.arguments || "{}") : call.arguments ?? {};
  } catch {
    return { name, ok: false, content: JSON.stringify({ error: "Tool arguments must be valid JSON." }) };
  }

  const outcome = implementation(args, context);
  const content =
    outcome.content.length > MAX_TOOL_OUTPUT_CHARS
      ? outcome.content.slice(0, MAX_TOOL_OUTPUT_CHARS)
      : outcome.content;

  return { name, ok: outcome.ok, content };
}

export { TOOL_NAMES };
