/**
 * Static API route table shared by the Vercel entry point and the local server.
 *
 * Why one table and one deployed function: the Vercel Hobby plan allows at most
 * 12 Serverless Functions per deployment, and every file under `api/` counts.
 * Market Lens has 20 routes, so `api/` holds a single entry (`api/index.js`) and
 * the handlers live in `handlers/`, which Vercel does not treat as functions.
 *
 * Nothing here is dynamic or filesystem-discovered: the table is static so the
 * function bundle always contains exactly the modules it imports.
 */

import { randomUUID } from "node:crypto";
import analysis from "../../handlers/analysis.js";
import coverage from "../../handlers/coverage.js";
import diagnostics from "../../handlers/diagnostics.js";
import finnhub from "../../handlers/finnhub.js";
import health from "../../handlers/health.js";
import history from "../../handlers/history.js";
import indicators from "../../handlers/indicators.js";
import instruments from "../../handlers/instruments.js";
import jobs from "../../handlers/jobs.js";
import jobDetail from "../../handlers/jobs/[jobId].js";
import market from "../../handlers/market.js";
import marketOverview from "../../handlers/market-overview.js";
import nav from "../../handlers/nav.js";
import news from "../../handlers/news.js";
import officialData from "../../handlers/official-data.js";
import providerStatus from "../../handlers/provider-status.js";
import quotes from "../../handlers/quotes.js";
import report from "../../handlers/report.js";
import research from "../../handlers/research.js";
import screener from "../../handlers/screener.js";
import search from "../../handlers/search.js";
import structure from "../../handlers/structure.js";
import topStocks from "../../handlers/top-stocks.js";
import universe from "../../handlers/universe.js";
import worker from "../../handlers/worker.js";

/** Ordered so static segments win over parameterised ones. */
const ROUTE_DEFINITIONS = [
  ["analysis", analysis],
  ["coverage", coverage],
  ["diagnostics", diagnostics],
  ["finnhub", finnhub],
  ["health", health],
  ["history", history],
  ["indicators", indicators],
  ["instruments", instruments],
  ["jobs", jobs],
  ["market", market],
  ["market-overview", marketOverview],
  ["nav", nav],
  ["news", news],
  ["official-data", officialData],
  ["provider-status", providerStatus],
  ["quotes", quotes],
  ["report", report],
  ["research", research],
  ["screener", screener],
  ["search", search],
  ["structure", structure],
  ["top-stocks", topStocks],
  ["universe", universe],
  ["worker", worker],
  ["jobs/:jobId", jobDetail]
];

function toPattern(definition) {
  const parts = definition.split("/").filter(Boolean);
  const params = [];
  const regex = parts
    .map((part) => {
      if (part.startsWith(":")) {
        params.push(part.slice(1));
        return "([^/]+)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { parts, params, regex: new RegExp(`^/api/${regex}/?$`) };
}

const ROUTES = ROUTE_DEFINITIONS.map(([definition, handler]) => ({
  definition,
  handler,
  ...toPattern(definition)
}));

const SEGMENT = /^[A-Za-z0-9._~-]{1,64}$/;
const MAX_PATH_LENGTH = 200;

/**
 * Validate and normalise an API path. Rejects traversal, encoded separators,
 * empty segments and anything outside the characters used by real routes.
 */
export function normalizeApiPath(pathname) {
  const value = String(pathname ?? "");
  if (!value || value.length > MAX_PATH_LENGTH) {
    const error = new Error("Invalid API path.");
    error.statusCode = 400;
    throw error;
  }

  let decoded;
  try {
    decoded = decodeURIComponent(value.split("?")[0].split("#")[0]);
  } catch {
    const error = new Error("Invalid API path encoding.");
    error.statusCode = 400;
    throw error;
  }

  if (decoded.includes("\\") || decoded.includes("%") || decoded.includes("//")) {
    const error = new Error("Invalid API path.");
    error.statusCode = 400;
    throw error;
  }

  const trimmed = decoded.length > 1 ? decoded.replace(/\/+$/, "") : decoded;
  if (trimmed === "/api") return "/api";
  if (!trimmed.startsWith("/api/")) {
    const error = new Error("Invalid API path.");
    error.statusCode = 400;
    throw error;
  }

  const segments = trimmed.slice("/api/".length).split("/");
  for (const segment of segments) {
    if (!SEGMENT.test(segment) || segment === "." || segment === "..") {
      const error = new Error("Invalid API path segment.");
      error.statusCode = 400;
      throw error;
    }
  }

  return `/api/${segments.join("/")}`;
}

/**
 * Rebuild the original `/api/...` path from a rewritten request.
 *
 * Vercel rewrites `/api/:path*` to `/api?__path=:path*` because a plain
 * `api/[...path].js` file is compiled as a single-segment route outside Next.js.
 * If the request arrived without the rewrite (local server, direct `/api`), the
 * path is taken from the URL instead.
 */
export function pathnameFromRequest(req) {
  const query = req?.query ?? {};
  const raw = query.__path;

  let suffix = "";
  if (typeof raw === "string") suffix = raw;
  else if (Array.isArray(raw)) suffix = raw.join("/");

  if (!suffix) {
    let pathname = "/api";
    try {
      pathname = new URL(req?.url || "/api", "http://localhost").pathname;
    } catch {
      pathname = "/api";
    }
    suffix = pathname.startsWith("/api/") ? pathname.slice("/api/".length) : "";
  }

  return normalizeApiPath(suffix ? `/api/${suffix.replace(/^\/+/, "")}` : "/api");
}

/** @returns {{handler: Function, params: Record<string,string>, definition: string}|null} */
export function matchApiRoute(pathname) {
  let normalized;
  try {
    normalized = normalizeApiPath(pathname);
  } catch {
    return null;
  }

  for (const route of ROUTES) {
    const match = normalized.match(route.regex);
    if (!match) continue;

    const params = {};
    route.params.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1] ?? "");
    });

    return { handler: route.handler, params, definition: route.definition };
  }

  return null;
}

/** Route definitions without handlers, for tests and docs. */
export function apiRoutes() {
  return ROUTES.map((route) => ({
    definition: route.definition,
    path: `/api/${route.definition.replace(":jobId", "{jobId}")}`,
    params: [...route.params]
  }));
}

/**
 * Dispatch a request to its handler. Shared by `api/index.js` (Vercel) and
 * `scripts/api-server.js` (local), so both use identical routing semantics.
 */
export async function dispatchApiRequest(req, res, { pathname, query = {} } = {}) {
  const incomingId = String(req?.headers?.["x-request-id"] || "").trim();
  const requestId = /^[A-Za-z0-9._-]{8,64}$/.test(incomingId) ? incomingId : randomUUID();

  req.requestId = requestId;
  res.setHeader?.("X-Request-Id", requestId);

  let status = 200;
  let settled = false;
  const originalStatus = typeof res.status === "function" ? res.status.bind(res) : null;
  const originalJson = typeof res.json === "function" ? res.json.bind(res) : null;

  if (originalStatus) {
    res.status = (code) => {
      status = Number(code) || status;
      return originalStatus(code);
    };
  }
  if (originalJson) {
    res.json = (payload) => {
      settled = true;
      if (payload && typeof payload === "object" && !Array.isArray(payload) && status >= 400 && !payload.requestId) {
        return originalJson({ ...payload, requestId });
      }
      return originalJson(payload);
    };
  }

  const startedAt = Date.now();
  const log = () => {
    if (String(process.env.LOG_REQUESTS ?? "on").toLowerCase() === "off") return;
    try {
      console.log(
        JSON.stringify({
          level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
          event: "api_request",
          requestId,
          method: req?.method || "GET",
          path: pathname,
          status,
          settled,
          durationMs: Date.now() - startedAt
        })
      );
    } catch {
      /* logging must never break a response */
    }
  };

  const match = matchApiRoute(pathname);
  if (!match) {
    res.status(404).json({ error: "API route not found." });
    log();
    return;
  }

  const cleaned = { ...query };
  delete cleaned.__path;

  req.query = { ...cleaned, ...match.params };

  try {
    await match.handler(req, res);
  } catch (error) {
    log();
    throw error;
  }
  log();
}
