import type { NextApiRequest, NextApiResponse } from "next";

// `global.maintenance` and `global.activeUsers` are polled by every open tab and make up over half of all API
// traffic. Neither response depends on who is asking, so the client fetches them from its own origin through this
// route, and a shared cache in front of us (Vercel's CDN) answers the polling instead of the API. Where there is no
// such cache (e.g. the standalone Node server), this is just a thin, uncached proxy.
//
// The caching rules go in `CDN-Cache-Control`, which Vercel (and other CDNs, per RFC 9213) honor in place of
// `Cache-Control`. We don't put `s-maxage`/`stale-while-revalidate` in `Cache-Control` itself, as browsers honor
// `stale-while-revalidate` too, and would then hand a polling tab its own previous (stale) response.
//
// TTLs, applied per CDN region (with `stale-while-revalidate`, the CDN keeps serving the last value while it refetches
// in the background, so under steady polling a value is at most ~TTL old and the API sees about one request per TTL):
// - `activeUsers` counts users who sent a heartbeat in the last 60s and tabs poll it every 30s, so 30s of staleness
//   is within the precision the number already has.
// - `maintenance` is polled every 60s. Keeping it at 15s means turning maintenance mode on/off reaches users at
//   most ~15s later than it would have otherwise.
const CDN_CACHE_POLICIES: Record<string, string> = {
  activeUsers: "public, max-age=30, stale-while-revalidate=30",
  maintenance: "public, max-age=15, stale-while-revalidate=15",
};

const UPSTREAM_TIMEOUT_MS = 10 * 1000;

function getApiBaseUrl() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "https://api.lapse.hackclub.com";
  return apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl;
}

function isOkResult(body: unknown) {
  return typeof body === "object" && body !== null && "ok" in body && body.ok === true;
}

function sendUncached(res: NextApiResponse, status: number, body: unknown) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const procedure = typeof req.query.procedure === "string" ? req.query.procedure : "";
  const cdnCachePolicy = Object.hasOwn(CDN_CACHE_POLICIES, procedure) ? CDN_CACHE_POLICIES[procedure] : null;

  if (cdnCachePolicy === null)
    return sendUncached(res, 404, { ok: false, error: "NOT_FOUND", message: "Unknown procedure." });

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return sendUncached(res, 405, { ok: false, error: "ERROR", message: "Method not allowed." });
  }

  // We deliberately forward none of the caller's headers (most importantly `Authorization` and cookies): the
  // response is shared between everyone, so it must never be computed on behalf of a specific user.
  let response: Response;
  let body: unknown;
  try {
    response = await fetch(`${getApiBaseUrl()}/api/global/${procedure}`, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    body = await response.json();
  }
  catch (error) {
    console.error(`(api/cached) upstream request for global.${procedure} failed`, error);
    return sendUncached(res, 502, { ok: false, error: "ERROR", message: "The API could not be reached." });
  }

  // Errors (including `{ ok: false }` results, which the API returns with a 200) are passed through as-is, but never
  // cached, so a blip upstream doesn't stick around at the edge.
  if (!response.ok || !isOkResult(body))
    return sendUncached(res, response.status, body);

  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  res.setHeader("CDN-Cache-Control", cdnCachePolicy);
  res.status(200).json(body);
}
