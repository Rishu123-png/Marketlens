/**
 * News and filing text is untrusted evidence.
 *
 * Nothing fetched from the internet is ever treated as an instruction. This
 * module strips markup, removes control characters, caps the excerpt length and
 * flags text that looks like an attempt to steer the model. Flagged text is
 * still passed on (redacted of markup) so the agent can describe it, but it is
 * always wrapped in an explicit evidence envelope and never placed in a system
 * prompt.
 */

const MAX_EXCERPT_CHARS = 1200;

const INJECTION_PATTERNS = [
  { id: "ignore-instructions", pattern: /ignore\s+(all\s+|any\s+)?(previous|prior|above)\s+instructions?/i },
  { id: "system-prompt", pattern: /system\s*prompt|developer\s*message|you\s+are\s+now\s+(a|an)\b/i },
  { id: "role-override", pattern: /act\s+as\s+(a|an)?\s*(system|admin|developer)|jailbreak|do\s+anything\s+now/i },
  { id: "prompt-leak", pattern: /reveal\s+(the\s+)?(prompt|instructions)|print\s+(the\s+)?(prompt|system)/i },
  { id: "price-instruction", pattern: /(buy|sell|short)\s+(this\s+)?(stock|share|instrument|now)\b/i },
  { id: "encoded-blob", pattern: /[A-Za-z0-9+/]{120,}={0,2}/ }
];

export function stripHtml(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function sanitizeExcerpt(text, { maxLength = MAX_EXCERPT_CHARS } = {}) {
  const plain = stripHtml(text)
    // control characters and bidi overrides are never legitimate in an excerpt
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!plain) return null;
  return plain.length > maxLength ? `${plain.slice(0, maxLength - 1).trimEnd()}…` : plain;
}

export function detectInjectionSignals(text) {
  const value = typeof text === "string" ? text : "";
  return INJECTION_PATTERNS.filter((entry) => entry.pattern.test(value)).map((entry) => entry.id);
}

/**
 * Wrap evidence before it is embedded in a prompt. The wrapper is inert text:
 * it tells the model where the untrusted region starts and ends, and the system
 * prompt states that everything inside is data.
 */
export function wrapUntrusted(text, label = "untrusted_evidence") {
  const safe = sanitizeExcerpt(text) ?? "";
  return `<${label}>\n${safe}\n</${label}>`;
}

export { MAX_EXCERPT_CHARS, INJECTION_PATTERNS };
