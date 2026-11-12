/**
 * Deterministic post-checks on agent output.
 *
 * The system prompt forbids recommendation language, but a prompt is not an
 * enforcement mechanism. These checks run on the parsed output and fail the
 * agent closed when it slips into advice or guarantees. Patterns are narrow on
 * purpose: "hold steady" is ordinary English, "hold rating" is advice.
 */

const PROHIBITED_PATTERNS = [
  { id: "recommendation", pattern: /\b(?:strong\s+)?(?:buy|sell|hold)\s+(?:rating|recommendation|call|signal)\b/i },
  { id: "recommendation", pattern: /\b(?:we|i)\s+(?:recommend|advise|suggest)\s+(?:buying|selling|holding|to\s+buy|to\s+sell)\b/i },
  { id: "recommendation", pattern: /\b(?:buy|sell)\s+(?:the\s+)?(?:stock|shares?|now|today)\b/i },
  { id: "price-target", pattern: /\b(?:price\s+target|target\s+price)\b/i },
  { id: "guarantee", pattern: /\b(?:guaranteed|assured)\s+(?:returns?|profits?|gains?)\b|\brisk[- ]free\s+(?:profit|return)\b/i },
  { id: "prediction", pattern: /\bwill\s+(?:definitely|certainly|surely)\s+(?:rise|fall|go\s+up|go\s+down|increase|decrease)\b/i }
];

/** Deep-scan every string in an output object. */
function collectStrings(value, out = [], depth = 0) {
  if (depth > 8 || value === null || value === undefined) return out;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const entry of value) collectStrings(entry, out, depth + 1);
  else if (typeof value === "object") for (const entry of Object.values(value)) collectStrings(entry, out, depth + 1);
  return out;
}

export function findProhibitedLanguage(output) {
  const violations = [];

  for (const text of collectStrings(output)) {
    for (const rule of PROHIBITED_PATTERNS) {
      if (rule.pattern.test(text)) {
        violations.push({ rule: rule.id, excerpt: text.slice(0, 160) });
        break;
      }
    }
  }

  return violations;
}

/**
 * Cross-check cited evidence ids against the envelope. Unknown ids are a
 * fabrication signal: the agent cited something it was never given.
 */
export function findUnknownEvidenceIds(output, allowedIds) {
  const allowed = new Set(allowedIds || []);
  const cited = Array.isArray(output?.evidenceIds) ? output.evidenceIds : [];
  return cited.filter((id) => !allowed.has(id));
}

export function validateAgentOutput(output, { allowedEvidenceIds = [] } = {}) {
  const prohibited = findProhibitedLanguage(output);
  const unknownEvidenceIds = findUnknownEvidenceIds(output, allowedEvidenceIds);

  return {
    ok: prohibited.length === 0 && unknownEvidenceIds.length === 0,
    prohibited,
    unknownEvidenceIds
  };
}
