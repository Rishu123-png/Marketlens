// Single Vercel Serverless Function for every /api/* route.
//
// The Hobby plan allows at most 12 functions per deployment and every file under
// `api/` counts, so the 20 route handlers live in `handlers/` and are dispatched
// from here through a static route table. `vercel.json` rewrites
// `/api/:path*` to `/api?__path=:path*`, because a plain `api/[...path].js` file
// is compiled as a single-segment route outside Next.js.
import { dispatchApiRequest, pathnameFromRequest } from "../server/http/router.js";

export default async function handler(req, res) {
  let pathname;
  try {
    pathname = pathnameFromRequest(req);
  } catch (error) {
    return res.status(error?.statusCode || 400).json({ error: error?.message || "Invalid API path." });
  }

  try {
    await dispatchApiRequest(req, res, { pathname, query: req.query ?? {} });
  } catch (error) {
    if (res.headersSent) return;
    const status = error?.statusCode || 500;
    return res.status(status).json({
      error: status === 500 ? "API request failed." : error.message,
      requestId: req.requestId ?? null
    });
  }
}
