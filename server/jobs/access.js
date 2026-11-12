/**
 * Lightweight job ownership.
 *
 * This deployment has no account system, so ownership is a high-entropy bearer
 * value generated and stored in the browser (`x-owner-id`). The server stores
 * only its SHA-256 hash. A job with an owner hash is invisible (404) to callers
 * that do not present the matching value. Jobs created before ownership existed
 * have no hash and remain readable as legacy public jobs.
 *
 * This is not a substitute for account authentication; it closes anonymous
 * enumeration of research jobs and reports without pretending to be SSO.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export const OWNER_HEADER = "x-owner-id";
const OWNER_PATTERN = /^[a-f0-9]{32,64}$/i;

export function ownerFromRequest(req) {
  const raw = req?.headers?.[OWNER_HEADER];
  const value = typeof raw === "string" ? raw.trim() : "";
  return OWNER_PATTERN.test(value) ? value.toLowerCase() : null;
}

export function ownerHash(owner) {
  if (!owner) return null;
  return createHash("sha256").update(owner).digest("hex");
}

export function ownerMatches(jobOwnerHash, owner) {
  if (!jobOwnerHash) return true; // legacy job without an owner
  const candidate = ownerHash(owner);
  if (!candidate) return false;
  const a = Buffer.from(jobOwnerHash, "hex");
  const b = Buffer.from(candidate, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
