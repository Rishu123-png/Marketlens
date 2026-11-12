/**
 * Object storage adapters for report artefacts (JSON + rendered markdown).
 *
 * - filesystem: local development and single-node deployments. Keys are
 *   sanitised so a report id cannot escape the root.
 * - s3: any S3-compatible endpoint, signed with SigV4 in this module (no SDK).
 *   Implemented but **not verified against a live bucket**; set
 *   S3_BUCKET / S3_REGION / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY (and
 *   optionally S3_ENDPOINT for R2/MinIO) to enable it.
 *
 * Keys are content-addressed by report id + version, never overwritten.
 */

import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash, createHmac } from "node:crypto";

export class ObjectStoreConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ObjectStoreConfigurationError";
    this.statusCode = 503;
  }
}

export function sanitizeKey(key) {
  const clean = String(key || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  if (!clean) throw new ObjectStoreConfigurationError("An object key is required.");
  return clean;
}

export function createFilesystemObjectStore({ root }) {
  if (!root) throw new ObjectStoreConfigurationError("A filesystem object-store root is required.");

  const resolve = (key) => path.join(root, sanitizeKey(key));

  return {
    kind: "filesystem",
    verification: "tested-local",
    async putObject(key, body, { contentType = "application/json" } = {}) {
      const target = resolve(key);
      await mkdir(path.dirname(target), { recursive: true });
      const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
      await writeFile(target, payload);
      return {
        key: sanitizeKey(key),
        bytes: Buffer.byteLength(payload),
        contentType,
        storedAt: new Date().toISOString()
      };
    },
    async getObject(key) {
      return readFile(resolve(key), "utf8");
    },
    async list(prefix = "") {
      try {
        return await readdir(path.join(root, sanitizeKey(prefix)));
      } catch {
        return [];
      }
    }
  };
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value).digest();
}

function encodePath(value) {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

/**
 * SigV4 signing for a single S3 request.
 * @returns {Record<string,string>} headers to send (includes Authorization)
 */
export function signS3Request({
  method,
  url,
  body = "",
  region,
  service = "s3",
  accessKeyId,
  secretAccessKey,
  extraHeaders = {},
  now = new Date()
}) {
  const parsed = new URL(url);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const headers = {
    host: parsed.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...Object.fromEntries(Object.entries(extraHeaders).map(([key, value]) => [key.toLowerCase(), String(value)]))
  };

  const sortedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaders.map((name) => `${name}:${headers[name].trim()}\n`).join("");
  const signedHeaders = sortedHeaders.join(";");
  const canonicalQuery = [...parsed.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");

  const canonicalRequest = [
    method.toUpperCase(),
    encodePath(parsed.pathname),
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  };
}

export function createS3ObjectStore(options = {}) {
  const bucket = options.bucket ?? process.env.S3_BUCKET;
  const region = options.region ?? process.env.S3_REGION ?? "auto";
  const accessKeyId = options.accessKeyId ?? process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = options.secretAccessKey ?? process.env.S3_SECRET_ACCESS_KEY;
  const endpoint = (options.endpoint ?? process.env.S3_ENDPOINT ?? `https://s3.${region}.amazonaws.com`).replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());

  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new ObjectStoreConfigurationError(
      "S3 storage requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY."
    );
  }

  function request(method, key, body = "", extraHeaders = {}) {
    const url = `${endpoint}/${bucket}/${encodePath(sanitizeKey(key))}`;
    const headers = signS3Request({
      method,
      url,
      body,
      region,
      accessKeyId,
      secretAccessKey,
      extraHeaders,
      now: now()
    });

    return fetchImpl(url, { method, headers, ...(body ? { body } : {}) });
  }

  return {
    kind: "s3",
    verification: "unverified",
    async putObject(key, body, { contentType = "application/json" } = {}) {
      const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
      const response = await request("PUT", key, payload, { "content-type": contentType });
      if (!response.ok) {
        throw new Error(`Object storage rejected the upload (${response.status}).`);
      }
      return { key: sanitizeKey(key), bytes: Buffer.byteLength(payload), contentType, storedAt: now().toISOString() };
    },
    async getObject(key) {
      const response = await request("GET", key);
      if (!response.ok) throw new Error(`Object storage read failed (${response.status}).`);
      return response.text();
    }
  };
}

export function objectStorageStatus(env = process.env) {
  const s3 = Boolean(env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
  return {
    active: s3 ? "s3" : "filesystem",
    s3: {
      configured: s3,
      verification: s3 ? "unverified" : "not-configured",
      note: s3
        ? "SigV4 signing is implemented in-repo and has not been validated against a live bucket."
        : "Set S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY for durable artefacts."
    },
    filesystem: { scope: "local-node", note: "Artefacts written next to the process; not shared across instances." }
  };
}
