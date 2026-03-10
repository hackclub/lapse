import type { NextApiRequest, NextApiResponse } from "next";

// This endpoint serves as a proxy for clients that haven't yet migrated to the new API path.
// It may be removed in the future, and clients should NOT rely on its availability.

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  }
};

function getProxyBaseUrl() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl)
    return null;

  return apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`;
}

function getEndpointPath(endpoint: string | string[] | undefined) {
  if (endpoint == undefined)
    return null;

  return typeof endpoint === "string" ? endpoint : endpoint.join("/");
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

  for (const [key, value] of Object.entries(req.headers)) {
    if (value == undefined || HOP_BY_HOP_HEADERS.has(key))
      continue;

    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
      continue;
    }

    headers.set(key, value);
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

function setResponseHeaders(res: NextApiResponse, response: Response) {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const setCookie = getSetCookie?.call(response.headers) ?? [];

  if (setCookie.length > 0)
    res.setHeader("set-cookie", setCookie);

  for (const [key, value] of response.headers.entries()) {
    if (key === "set-cookie" || HOP_BY_HOP_HEADERS.has(key))
      continue;

    res.setHeader(key, value);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const endpoint = getEndpointPath(req.query.endpoint);
  const proxyBaseUrl = getProxyBaseUrl();

  if (!endpoint) {
    res.status(200).send(`Use ${proxyBaseUrl ?? "the configured API URL"} instead! This is a proxy for apps using the legacy API path.`);
    return;
  }

  if (!proxyBaseUrl) {
    res.status(500).send("NEXT_PUBLIC_API_URL is not configured.");
    return;
  }

  const targetUrl = new URL(endpoint, proxyBaseUrl);
  appendQueryParams(targetUrl, req.query);

  const method = req.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : await readRequestBody(req);

  try {
    const response = await fetch(targetUrl, {
      method,
      headers: getProxyHeaders(req),
      body,
      redirect: "manual",
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
