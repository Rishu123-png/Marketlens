import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { buildRouteTable, matchRoute } from "./api-router.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDirectory = path.join(root, "api");
const MAX_BODY_BYTES = 256 * 1024;

let routeTablePromise = null;
const moduleCache = new Map();

function getRouteTable() {
  routeTablePromise ??= buildRouteTable(apiDirectory);
  return routeTablePromise;
}

function loadHandler(file) {
  if (!moduleCache.has(file)) moduleCache.set(file, import(pathToFileURL(file)));
  return moduleCache.get(file);
}

/** Test hook: forget discovered routes and cached handler modules. */
export function resetApiRouter() {
  routeTablePromise = null;
  moduleCache.clear();
}

export async function loadLocalEnvironment() {
  for (const file of [".env.local", ".env"]) {
    let text;
    try {
      text = await readFile(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=\s*(.*?)\s*$/);
      if (!match || Object.hasOwn(process.env, match[1])) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/, "");
      }
      process.env[match[1]] = value;
    }
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!size) return undefined;
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function jsonResponse(outgoing) {
  return (status) =>
    (data) => {
      const payload = JSON.stringify(data);
      outgoing.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      });
      outgoing.end(payload);
    };
}

export function createApiServer() {
  return createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url || "/", "http://localhost");

    try {
      const table = await getRouteTable();
      const match = matchRoute(table, url.pathname);

      if (!match) {
        jsonResponse(outgoing)(404)({ error: "API route not found." });
        return;
      }

      const query = {
        ...Object.fromEntries(url.searchParams.entries()),
        ...match.params
      };
      const body = ["GET", "HEAD"].includes(incoming.method) ? undefined : await readBody(incoming);
      const req = Object.assign(incoming, { query, body });

      let status = 200;
      let sent = false;
      const res = {
        status(code) {
          status = code;
          return this;
        },
        setHeader(name, value) {
          outgoing.setHeader(name, value);
          return this;
        },
        json(data) {
          if (sent) return this;
          sent = true;
          jsonResponse(outgoing)(status)(data);
          return this;
        }
      };

      const module = await loadHandler(match.route.file);
      await module.default(req, res);
      if (!sent) res.status(204).json(null);
    } catch (error) {
      if (outgoing.headersSent) return outgoing.end();
      const status = error.statusCode || 500;
      outgoing.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      outgoing.end(
        JSON.stringify({
          error: status === 500 ? "API request failed." : error.message
        })
      );
    }
  });
}

// Keep this server private to the local machine; Vite proxies browser requests to it.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await loadLocalEnvironment();
  const server = createApiServer();
  const port = Number(process.env.API_PORT || 8787);
  server.listen(port, "127.0.0.1", () => {
    console.log(`MarketLens API listening on http://127.0.0.1:${port}`);
  });
}
