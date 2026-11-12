/**
 * Filesystem-based API routing shared by local dev and (structurally) Vercel.
 *
 * api/<name>.js                  → /api/<name>
 * api/<name>/index.js            → /api/<name>
 * api/<name>/[id]/index.js       → /api/<name>/:id
 * api/<name>/[id]/<sub>.js       → /api/<name>/:id/<sub>
 *
 * Static segments win over dynamic ones, so /api/reports/summary is not captured
 * by /api/reports/[reportId].
 */

import { readdir } from "node:fs/promises";
import path from "node:path";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function walk(directory, base = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full, base)));
    else if (entry.name.endsWith(".js")) files.push(full);
  }

  return files;
}

export async function buildRouteTable(apiDirectory) {
  const files = await walk(apiDirectory);

  const routes = files.map((file) => {
    const relative = path.relative(apiDirectory, file).split(path.sep).join("/");
    const segments = relative.replace(/\.js$/, "").split("/");
    if (segments.at(-1) === "index") segments.pop();

    const params = [];
    const pattern = segments.map((segment) => {
      const dynamic = segment.match(/^\[(.+)\]$/);
      if (dynamic) {
        params.push(dynamic[1]);
        return "([^/]+)";
      }
      return escapeRegExp(segment);
    });

    return {
      file,
      segments: segments.join("/"),
      params,
      regex: new RegExp(`^/api/${pattern.join("/")}/?$`)
    };
  });

  // Fewer dynamic segments first: static paths must beat parameterised ones.
  return routes.sort((a, b) => a.params.length - b.params.length || a.segments.localeCompare(b.segments));
}

export function matchRoute(table, pathname) {
  const candidates = [pathname];

  // Accept the explicit /.js form used by some clients and by Vercel rewrites.
  if (pathname.endsWith(".js")) candidates.push(pathname.slice(0, -3));

  for (const candidate of candidates) {
    for (const route of table) {
      const match = route.regex.exec(candidate);
      if (!match) continue;

      const params = {};
      route.params.forEach((name, index) => {
        params[name] = decodeURIComponent(match[index + 1]);
      });

      return { route, params };
    }
  }

  return null;
}
