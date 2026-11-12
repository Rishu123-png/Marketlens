/**
 * Central Groq credential routing.
 *
 * One resolver decides which environment variable supplies the credential for a
 * logical agent. Agents never read `process.env.GROQ_API_KEY_*` themselves, and
 * the provider is always given an explicit key — it has no implicit fallback.
 *
 * Security rules:
 * - only the environment-variable NAME and the mode are ever returned to
 *   telemetry, status endpoints or logs;
 * - the secret value is returned only from `getGroqCredential`, for the single
 *   purpose of building the Authorization header, and must never be serialised;
 * - separate keys provide accounting/isolation, not a multiplied rate limit.
 *   Groq organisation/project quotas still apply and 429s are honoured.
 */

import { AGENT_IDS } from "../../shared/schemas/agent.js";

export const GROQ_SHARED_KEY_ENV = "GROQ_API_KEY";

/** Exact server-side variable names required for dedicated agent credentials. */
export const GROQ_AGENT_KEY_ENV = Object.freeze({
  chart: "GROQ_API_KEY_CHART",
  technical: "GROQ_API_KEY_TECHNICAL",
  news: "GROQ_API_KEY_NEWS",
  sentiment: "GROQ_API_KEY_SENTIMENT",
  risk: "GROQ_API_KEY_RISK",
  coordinator: "GROQ_API_KEY_COORDINATOR"
});

export const CREDENTIAL_MODES = Object.freeze(["dedicated", "shared", "none"]);

export class GroqCredentialError extends Error {
  constructor(message, { agent, envName, reason = "missing", configuration = [] } = {}) {
    super(message);
    this.name = "GroqCredentialError";
    this.kind = "configuration";
    this.agent = agent ?? null;
    this.envName = envName ?? null;
    this.reason = reason;
    this.configuration = configuration;
    this.credentialMode = "none";
  }
}

function read(env, name) {
  const value = env?.[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function truthy(value) {
  return ["1", "true", "on", "yes", "required"].includes(String(value ?? "").toLowerCase());
}

/** `GROQ_AGENT_KEYS_REQUIRED=true` forbids the shared fallback. */
export function agentKeysRequired(env = process.env) {
  return truthy(env?.GROQ_AGENT_KEYS_REQUIRED);
}

/** Explicitly permit (or forbid) the shared fallback outside strict mode. */
export function sharedFallbackPermitted(env = process.env) {
  if (agentKeysRequired(env)) return false;
  const setting = String(env?.GROQ_SHARED_KEY_FALLBACK ?? "on").toLowerCase();
  return !["0", "false", "off", "no", "disabled"].includes(setting);
}

export function assertKnownAgent(agent) {
  if (!AGENT_IDS.includes(agent)) throw new RangeError(`Unknown agent: ${agent}`);
  return agent;
}

export function credentialEnvNameFor(agent) {
  return GROQ_AGENT_KEY_ENV[assertKnownAgent(agent)];
}

/**
 * Internal resolver. The returned `apiKey` is for the provider call only and is
 * never included in agent runs, status responses or logs.
 *
 * @returns {{apiKey:string, envName:string, mode:"dedicated"|"shared", agent:string}}
 */
export function getGroqCredential(agent, { env = process.env, allowShared = undefined } = {}) {
  assertKnownAgent(agent);
  const dedicatedName = GROQ_AGENT_KEY_ENV[agent];
  const dedicated = read(env, dedicatedName);

  if (dedicated) {
    return { apiKey: dedicated, envName: dedicatedName, mode: "dedicated", agent };
  }

  const required = agentKeysRequired(env);
  const permitted = allowShared === undefined ? sharedFallbackPermitted(env) : allowShared === true && !required;
  const shared = permitted ? read(env, GROQ_SHARED_KEY_ENV) : null;

  if (shared) {
    return { apiKey: shared, envName: GROQ_SHARED_KEY_ENV, mode: "shared", agent };
  }

  const reason = required ? "dedicated-key-required" : permitted ? "missing" : "shared-fallback-disabled";
  throw new GroqCredentialError(
    required
      ? `Agent ${agent} requires its dedicated credential ${dedicatedName}; shared fallback is disabled by GROQ_AGENT_KEYS_REQUIRED.`
      : permitted
        ? `Agent ${agent} has no credential configured (${dedicatedName} or ${GROQ_SHARED_KEY_ENV}).`
        : `Agent ${agent} has no dedicated credential and shared fallback is disabled.`,
    {
      agent,
      envName: dedicatedName,
      reason,
      configuration: permitted ? [dedicatedName, GROQ_SHARED_KEY_ENV] : [dedicatedName]
    }
  );
}

/**
 * Safe description for status endpoints and diagnostics. Contains no secret
 * values or prefixes, only environment-variable names and booleans.
 */
export function describeGroqCredentials(env = process.env) {
  const agents = {};
  for (const agent of AGENT_IDS) {
    const envName = GROQ_AGENT_KEY_ENV[agent];
    const dedicated = Boolean(read(env, envName));
    const shared = Boolean(read(env, GROQ_SHARED_KEY_ENV));
    const fallbackPermitted = sharedFallbackPermitted(env);
    agents[agent] = {
      envName,
      configured: dedicated,
      selected: dedicated ? "dedicated" : shared && fallbackPermitted ? "shared" : "none",
      mode: dedicated ? "dedicated" : shared && fallbackPermitted ? "shared" : "none"
    };
  }

  const dedicatedConfigured = Object.values(agents).filter((entry) => entry.configured).length;
  return {
    provider: "groq",
    strictMode: agentKeysRequired(env),
    sharedFallback: {
      envName: GROQ_SHARED_KEY_ENV,
      configured: Boolean(read(env, GROQ_SHARED_KEY_ENV)),
      permitted: sharedFallbackPermitted(env)
    },
    agents,
    dedicatedConfigured,
    agentsConfigured: Object.keys(agents).length,
    anyConfigured: dedicatedConfigured > 0 || (sharedFallbackPermitted(env) && Boolean(read(env, GROQ_SHARED_KEY_ENV))),
    note:
      "Separate keys isolate credentials and per-key accounting. They do not multiply Groq organisation/project rate limits; 429 responses are honoured."
  };
}

export function hasAnyGroqCredential(env = process.env) {
  return describeGroqCredentials(env).anyConfigured;
}

/** Agent ids and their dedicated variable names, for documentation and tests. */
export function credentialMap() {
  return { ...GROQ_AGENT_KEY_ENV, shared: GROQ_SHARED_KEY_ENV };
}
