/**
 * Deterministic news/filing fingerprinting and evidence construction.
 *
 * One story can arrive from several syndicators with different URLs. The
 * fingerprint is derived from the normalized headline only, so repeated copies
 * collapse into a single evidence item and repetition cannot look like
 * independent confirmation.
 */

import { createHash } from "node:crypto";
import { evidenceSchema } from "../../shared/schemas/evidence.js";
import { detectInjectionSignals, sanitizeExcerpt } from "./sanitize.js";

export function normalizeTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\u0900-\u097F]+/g, " ")
    .replace(/^\s*(live|updated|breaking|exclusive)\s*:?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function fingerprint(title) {
  return createHash("sha256").update(normalizeTitle(title)).digest("hex").slice(0, 32);
}

export function evidenceId(sourceType, title, publishedAt) {
  return createHash("sha256")
    .update(`${sourceType}|${normalizeTitle(title)}|${publishedAt || "undated"}`)
    .digest("hex")
    .slice(0, 24);
}

function isoOrNull(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

/**
 * Build a schema-valid evidence item. Returns `{ ok, item }` or
 * `{ ok: false, reason }`; nothing is coerced into a fake URL or timestamp.
 */
export function toEvidence(input) {
  const retrievedAt = isoOrNull(input.retrievedAt) ?? new Date().toISOString();
  const publishedAt = isoOrNull(input.publishedAt);

  const excerpt = sanitizeExcerpt(input.excerpt ?? input.description ?? "");
  const title = sanitizeExcerpt(input.title ?? "", { maxLength: 300 });
  const combined = `${title ?? ""} ${excerpt ?? ""}`;
  const injectionSignals = detectInjectionSignals(combined);

  const candidate = {
    id: evidenceId(input.sourceType, title || input.url || "", publishedAt),
    sourceType: input.sourceType,
    publisher: sanitizeExcerpt(input.publisher ?? "", { maxLength: 120 }) || "Unknown publisher",
    url: typeof input.url === "string" && input.url.trim() ? input.url.trim() : null,
    publishedAt,
    retrievedAt,
    instrumentIds: Array.isArray(input.instrumentIds) ? [...new Set(input.instrumentIds)] : [],
    excerpt,
    verification: input.verification ?? "reported",
    dedupeFingerprint: fingerprint(title || excerpt || ""),
    metadata: {
      title: title ?? null,
      language: input.language ?? "en",
      provider: input.provider ?? null,
      injectionSignals,
      untrusted: true
    }
  };

  const parsed = evidenceSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      reason: parsed.error.issues.map((issue) => `${issue.path.join(".") || "item"}: ${issue.message}`).join("; ")
    };
  }

  return { ok: true, item: parsed.data };
}

/** Collapse duplicate stories, keeping the earliest published copy. */
export function dedupeEvidence(items) {
  const byFingerprint = new Map();

  for (const item of items) {
    const existing = byFingerprint.get(item.dedupeFingerprint);
    if (!existing) {
      byFingerprint.set(item.dedupeFingerprint, { ...item, duplicateCount: 1 });
      continue;
    }

    const existingTime = Date.parse(existing.publishedAt ?? existing.retrievedAt);
    const nextTime = Date.parse(item.publishedAt ?? item.retrievedAt);
    const duplicateCount = (existing.duplicateCount ?? 1) + 1;

    if (nextTime < existingTime) byFingerprint.set(item.dedupeFingerprint, { ...item, duplicateCount });
    else byFingerprint.set(item.dedupeFingerprint, { ...existing, duplicateCount });
  }

  return [...byFingerprint.values()].sort(
    (a, b) => Date.parse(b.publishedAt ?? b.retrievedAt) - Date.parse(a.publishedAt ?? a.retrievedAt)
  );
}
