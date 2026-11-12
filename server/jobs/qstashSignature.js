/**
 * Upstash QStash request-signature verification (HS256 JWT).
 *
 * QStash signs each delivery with a JWT whose payload binds the request body
 * (`body` = base64url(SHA-256(rawBody))). We verify:
 *   - HS256 signature against the current and next signing keys,
 *   - `exp`/`nbf` validity,
 *   - issuer when present,
 *   - the body digest, when a body claim is present and the raw body is available.
 *
 * Verification fails closed. No signing key configured means verification is
 * "not-configured", and the caller must fall back to WORKER_SECRET.
 */

import { createHmac, createHash, timingSafeEqual } from "node:crypto";

function decodeJson(segment) {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function verifyWithKey(token, key) {
  const [header, payload, signature] = String(token).split(".");
  if (!header || !payload || !signature) return false;
  const expected = createHmac("sha256", key).update(`${header}.${payload}`).digest("base64url");
  return safeEqual(expected, signature);
}

export function qstashKeys(env = process.env) {
  return [env.QSTASH_CURRENT_SIGNING_KEY, env.QSTASH_NEXT_SIGNING_KEY].filter(Boolean);
}

/**
 * @param {{signature?:string, rawBody?:string|null, keys?:string[], now?:number, env?:object}} options
 */
export function verifyQstashSignature({ signature, rawBody = null, keys = null, now = Date.now(), env = process.env } = {}) {
  const signingKeys = keys || qstashKeys(env);
  if (!signingKeys.length) return { ok: false, status: "not-configured", reason: "No QStash signing key configured." };
  if (!signature) return { ok: false, status: "missing", reason: "Upstash-Signature header is missing." };

  const matched = signingKeys.some((key) => verifyWithKey(signature, key));
  if (!matched) return { ok: false, status: "invalid", reason: "QStash signature did not verify against a configured key." };

  const payload = decodeJson(String(signature).split(".")[1]);
  if (!payload) return { ok: false, status: "invalid", reason: "QStash signature payload is not valid JSON." };

  const seconds = Math.floor(now / 1000);
  if (!Number.isFinite(payload.exp)) {
    return { ok: false, status: "invalid", reason: "QStash signature has no expiry claim." };
  }
  if (payload.exp < seconds) {
    return { ok: false, status: "expired", reason: "QStash signature has expired." };
  }
  if (Number.isFinite(payload.nbf) && payload.nbf > seconds + 5) {
    return { ok: false, status: "invalid", reason: "QStash signature is not valid yet." };
  }
  if (payload.iss && payload.iss !== "Upstash") {
    return { ok: false, status: "invalid", reason: "Unexpected QStash issuer." };
  }

  if (payload.body) {
    if (typeof rawBody !== "string") {
      return {
        ok: false,
        status: "body-unavailable",
        reason: "The signature binds the request body, but the raw body was not available to verify it."
      };
    }
    const digest = createHash("sha256").update(rawBody).digest("base64url");
    if (!safeEqual(digest, payload.body)) {
      return { ok: false, status: "body-mismatch", reason: "Request body does not match the signed digest." };
    }
  }

  return { ok: true, status: "verified", reason: null, payload };
}

/** Test/helper: mint a signature in the QStash format. */
export function signQstashPayload({ key, body = null, exp = Math.floor(Date.now() / 1000) + 60, iss = "Upstash" }) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = { iss, exp };
  if (body !== null) payload.body = createHash("sha256").update(body).digest("base64url");
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", key).update(`${header}.${encoded}`).digest("base64url");
  return `${header}.${encoded}.${signature}`;
}
