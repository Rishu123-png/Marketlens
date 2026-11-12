/**
 * Queue adapter.
 *
 * O1: multi-agent research must not run inside a Vercel request. The API only
 * creates a job and hands its id to a queue; an independently deployed worker
 * (see `scripts/worker.js`) performs the work.
 *
 * Two adapters:
 * - memory   — local development, tests and single-process deployments.
 * - qstash   — Upstash QStash publish API, used when `QSTASH_TOKEN` and
 *              `WORKER_URL` are configured. Delivery is a POST to the worker
 *              with the job id; the worker acknowledges after claiming it.
 *
 * The QStash path is implemented against the documented publish endpoint but is
 * **not verified against a live Upstash account** in this environment.
 */

export const QSTASH_PUBLISH_URL = "https://qstash.upstash.io/v2/publish";

export class QueueConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "QueueConfigurationError";
    this.statusCode = 503;
  }
}

export function createMemoryQueue() {
  const items = [];

  return {
    id: "memory",
    async enqueue(payload) {
      items.push({ ...payload, enqueuedAt: new Date().toISOString() });
      return { queued: true, queue: "memory", depth: items.length };
    },
    async dequeue() {
      return items.shift() ?? null;
    },
    size() {
      return items.length;
    },
    clear() {
      items.length = 0;
    }
  };
}

/**
 * Publish a job id to QStash. QStash calls `workerUrl` with the payload.
 * @param {{jobId:string}} payload
 * @param {{token?:string, workerUrl?:string, fetchImpl?:Function, deduplicationId?:string}} [options]
 */
export async function publishToQStash(payload, options = {}) {
  const token = options.token ?? process.env.QSTASH_TOKEN;
  const workerUrl = options.workerUrl ?? process.env.WORKER_URL;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (!token) throw new QueueConfigurationError("QSTASH_TOKEN is not configured.");
  if (!workerUrl) throw new QueueConfigurationError("WORKER_URL is not configured.");

  let parsedWorkerUrl;
  try {
    parsedWorkerUrl = new URL(workerUrl);
  } catch {
    throw new QueueConfigurationError("WORKER_URL is not a valid absolute URL.");
  }
  if (parsedWorkerUrl.protocol !== "https:") {
    throw new QueueConfigurationError("WORKER_URL must use HTTPS so the job id and credentials are not sent in clear text.");
  }

  const response = await fetchImpl(`${QSTASH_PUBLISH_URL}/${encodeURIComponent(workerUrl)}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(options.deduplicationId ? { "upstash-deduplication-id": options.deduplicationId } : {}),
      // Research jobs are long; give the worker up to 15 minutes.
      "upstash-timeout": "900"
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();

  if (!response.ok) {
    throw new QueueConfigurationError(`QStash publish failed (${response.status}): ${text.slice(0, 200)}`);
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }

  return { queued: true, queue: "qstash", messageId: parsed?.messageId ?? null };
}

export function createQStashQueue(options = {}) {
  return {
    id: "qstash",
    async enqueue(payload) {
      return publishToQStash(payload, {
        ...options,
        deduplicationId: payload.deduplicationId ?? payload.jobId
      });
    },
    async dequeue() {
      throw new QueueConfigurationError("QStash delivers to the worker over HTTP; polling is not applicable.");
    },
    size() {
      return null;
    }
  };
}

let sharedMemoryQueue = createMemoryQueue();

/**
 * The queue the API should publish to. Without QStash configuration this is a
 * process-local queue, which only works when a worker runs in the same process.
 */
export function getQueue() {
  return process.env.QSTASH_TOKEN && process.env.WORKER_URL ? createQStashQueue() : sharedMemoryQueue;
}

/** Worker authentication mode implied by the current environment. */
export function workerAuthMode(env = process.env) {
  if (env.QSTASH_CURRENT_SIGNING_KEY || env.QSTASH_NEXT_SIGNING_KEY) return "qstash-signature";
  if (env.WORKER_SECRET) return "worker-secret";
  return "disabled";
}

export function resetQueueForTests() {
  sharedMemoryQueue = createMemoryQueue();
  return sharedMemoryQueue;
}

export function queueStatus(env = process.env) {
  const qstash = Boolean(env.QSTASH_TOKEN && env.WORKER_URL);
  return {
    active: qstash ? "qstash" : "memory",
    qstash: {
      configured: qstash,
      verification: qstash ? "configured-unverified" : "not-configured",
      workerUrlHttps: (() => {
        try {
          return new URL(env.WORKER_URL).protocol === "https:";
        } catch {
          return false;
        }
      })(),
      notes: qstash
        ? "Requires the worker to be deployed, HTTPS-reachable at WORKER_URL, and to accept the configured authentication."
        : "Set QSTASH_TOKEN and WORKER_URL to deliver jobs to an independent worker."
    },
    workerAuth: {
      mode: workerAuthMode(env),
      signatureVerification: env.QSTASH_CURRENT_SIGNING_KEY
        ? "configured-unverified"
        : "not-configured",
      note:
        workerAuthMode(env) === "disabled"
          ? "The worker endpoint refuses all deliveries until WORKER_SECRET or a QStash signing key is configured."
          : "The worker endpoint verifies QStash signatures when a signing key is configured, otherwise it requires WORKER_SECRET."
    },
    memory: {
      scope: "process-local",
      warning: "The memory queue cannot deliver jobs across serverless instances; production requires QStash."
    }
  };
}
