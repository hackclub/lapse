import type { NextApiRequest, NextApiResponse } from "next";

// This endpoint serves as a proxy for clients that haven't yet migrated to the new API path.
// It may be removed in the future, and clients should NOT rely on its availability.
//
// It runs on the same origin as the web app, so anything it echoes back can read the session token in
// `localStorage`. It must only ever reach our own API, forward only the headers an API call needs, and
// never hand back something a browser would render.

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  }
};

const UPSTREAM_TIMEOUT_MS = 30 * 1000;

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "authorization",
  "content-type",
  "if-none-match",
  "origin",
  "user-agent",
];

const FORWARDED_RESPONSE_HEADERS = new Set([
  "cache-control",
  "etag",
  "last-modified",
  "retry-after",
  "vary",
  "access-control-allow-origin",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-expose-headers",
  "access-control-max-age",
]);

const SAFE_CONTENT_TYPE = /^(application\/([\w.+-]+\+)?json|text\/plain)\s*(;|$)/i;

// Real endpoints are plain words like `timelapse/query`. Anything else - empty segments, `.`/`..`, or the
// `https:`, `//host` and `%2F` tricks that would turn the path into an absolute URL - is refused outright.
const ENDPOINT_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

function getProxyBase(): URL | null {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl)
    return null;

  return new URL(`${apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl}/api/`);
}

function getEndpointSegments(endpoint: string | string[] | undefined): string[] | null {
  if (endpoint == undefined)
    return null;

  return typeof endpoint === "string" ? [endpoint] : endpoint;
}

function buildTargetUrl(base: URL, segments: string[]): URL | null {
  if (segments.length === 0 || !segments.every(segment => ENDPOINT_SEGMENT.test(segment)))
    return null;

  const target = new URL(segments.join("/"), base);
  if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname))
    return null;

  return target;
}

function appendQueryParams(targetUrl: URL, query: NextApiRequest["query"]) {
  for (const [key, value] of Object.entries(query)) {
    if (key === "endpoint" || value == undefined)
      continue;

    if (typeof value === "string") {
      targetUrl.searchParams.append(key, value);
      continue;
    }

    for (const item of value) {
      targetUrl.searchParams.append(key, item);
    }
  }
}

function getProxyHeaders(req: NextApiRequest) {
  const headers = new Headers();

  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers[name];
    if (value == undefined)
      continue;

    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }

  return headers;
}

async function readRequestBody(req: NextApiRequest) {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0)
    return undefined;

  return Buffer.concat(chunks);
}

function setSecurityHeaders(res: NextApiResponse) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; sandbox");
}

// Cookies (both ways) and `Access-Control-Allow-Credentials` are left out on purpose: the API authenticates with bearer
// tokens, and this origin's cookies are none of its business.
function setResponseHeaders(res: NextApiResponse, response: Response) {
  for (const [key, value] of response.headers.entries()) {
    if (FORWARDED_RESPONSE_HEADERS.has(key))
      res.setHeader(key, value);
  }

  const contentType = response.headers.get("content-type");
  res.setHeader("Content-Type", contentType && SAFE_CONTENT_TYPE.test(contentType) ? contentType : "application/octet-stream");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setSecurityHeaders(res);

  const segments = getEndpointSegments(req.query.endpoint);
  const proxyBase = getProxyBase();

  if (!segments) {
    res.status(200).send(`Use ${proxyBase?.href ?? "the configured API URL"} instead! This is a proxy for apps using the legacy API path.`);
    return;
  }

  if (!proxyBase) {
    res.status(500).send("NEXT_PUBLIC_API_URL is not configured.");
    return;
  }

  const targetUrl = buildTargetUrl(proxyBase, segments);
  if (!targetUrl) {
    res.status(404).send("Unknown endpoint.");
    return;
  }

  appendQueryParams(targetUrl, req.query);

  const method = req.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : await readRequestBody(req);

  try {
    const response = await fetch(targetUrl, {
      method,
      headers: getProxyHeaders(req),
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    setResponseHeaders(res, response);
    res.status(response.status);

    const responseBody = Buffer.from(await response.arrayBuffer());

    if (responseBody.length === 0) {
      res.end();
      return;
    }

    res.send(responseBody);
  }
  catch {
    res.status(502).send("Legacy API proxy request failed.");
  }
}
