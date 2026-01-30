import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { setupEnvMock } from "./mocks/env";
import { setupDatabaseMock, mockDatabase, resetMockDatabase } from "./mocks/database";

setupDatabaseMock();
setupEnvMock();

let restHandler: (req: NextApiRequest, res: NextApiResponse) => Promise<void>;
let generateJWT: (userId: string, email: string) => string;
let generateOboJWT: (
  userId: string,
  email: string,
  actorId: string,
  scopes: string[],
  ttl: number,
) => string;
let hashServiceSecret: (secret: string) => string;

function createRes() {
  const headers: Record<string, string> = {};
  let body: unknown = null;
  return {
    statusCode: 200,
    headers,
    get body() {
      return body;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  };
}

function createReq(options: {
  method: string;
  body?: unknown;
  query?: Record<string, string | string[]>;
  headers?: Record<string, string>;
}) {
  return {
    method: options.method,
    body: options.body,
    query: options.query ?? {},
    headers: options.headers ?? {},
  };
}

beforeEach(async () => {
  resetMockDatabase();
  restHandler = await import("@/pages/api/rest/[router]/[procedure]").then(
    (mod) => mod.default,
  );

  const authModule = await import("@/server/auth");
  generateJWT = authModule.generateJWT;
  generateOboJWT = authModule.generateOboJWT;
  hashServiceSecret = authModule.hashServiceSecret;
});

afterEach(() => {
  vi.clearAllMocks();
  resetMockDatabase();
});

describe("rest api", () => {
  it("handles malformed query parameters", async () => {
    const res = createRes();
    const req = createReq({
      method: "GET",
      query: { router: ["not-a-string"], procedure: "123" } as Record<string, string | string[]>, // Invalid parameter types
    });

    await restHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    expect(res.statusCode).toBe(400);
  });

  it("rejects requests with missing router parameter", async () => {
    const res = createRes();
    const req = createReq({
      method: "GET",
      query: { procedure: "activeUsers" },
    });

    await restHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    expect(res.statusCode).toBe(400);
  });

  it("rejects requests with invalid router name", async () => {
    const res = createRes();
    const req = createReq({
      method: "GET",
      query: { router: "invalid", procedure: "test" },
    });

    await restHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      error: "not_found",
      error_description: "Unknown REST procedure.",
    });
  });

  it("rejects requests with invalid procedure name", async () => {
    const res = createRes();
    const req = createReq({
      method: "GET",
      query: { router: "global", procedure: "invalid" },
    });

    await restHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      error: "not_found",
      error_description: "Unknown REST procedure.",
    });
  });

  it("rejects wrong HTTP method for GET endpoints", async () => {
    const res = createRes();
    const req = createReq({
      method: "POST",
      query: { router: "global", procedure: "activeUsers" },
    });

    await restHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({
      error: "invalid_request",
      error_description: "Method not allowed.",
    });
  });

  it("rejects wrong HTTP method for POST endpoints", async () => {
    const res = createRes();
    const req = createReq({
      method: "GET",
      query: { router: "user", procedure: "registerDevice" },
    });

    await restHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({
      error: "invalid_request",
      error_description: "Method not allowed.",
    });
  });

  it("rejects unsupported HTTP method", async () => {
    const res = createRes();
    const req = createReq({
      method: "PATCH",
      query: { router: "global", procedure: "activeUsers" },
    });

    await restHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({
      error: "invalid_request",
      error_description: "Method not allowed.",
    });
  });

  it("allows access to public endpoints without auth", async () => {
    mockDatabase.user.aggregate.mockResolvedValue({
      _count: { lastHeartbeat: 7 },
    } as never);

    const res = createRes();
    const req = createReq({
      method: "GET",
      query: { router: "global", procedure: "activeUsers" },
    });

    await restHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      data: { count: 7 },
    });
  });

  it("enforces authentication for protected endpoints", async () => {
    const res = createRes();
    const req = createReq({
      method: "GET",
      query: { router: "user", procedure: "getDevices" },
    });

    await restHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: "unauthorized",
      error_description: "Authentication required.",
    });
  });

  it("handles malformed JWT tokens", async () => {
    const res = createRes();
    const req = createReq({
      method: "GET",
      query: { router: "user", procedure: "getDevices" },
      headers: { authorization: "Bearer not.a.valid.jwt.token" },
    });

    await restHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: "unauthorized",
      error_description: "Authentication required.",
    });
  });

  it("supports OBO authentication with correct scopes", async () => {
    const user = {
      id: "rest-user-1",
      email: "rest-test@example.com",
    };
    const client = {
      id: "rest-client-1",
      clientId: "svc_rest_test_1",
    };

    mockDatabase.user.findFirst.mockResolvedValue(user as never);
    mockDatabase.serviceClient.findFirst.mockResolvedValue(client as never);
    mockDatabase.knownDevice.findMany.mockResolvedValue([]);

    const oboToken = generateOboJWT(
      user.id,
      user.email,
      client.id,
      ["user:read"],
      900,
    );

    const res = createRes();
    const req = createReq({
      method: "GET",
      query: { router: "user", procedure: "getDevices" },
      headers: { authorization: `Bearer ${oboToken}` },
    });

    await restHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      data: { devices: [] },
    });
  });

  it("rejects OBO authentication with insufficient scopes", async () => {
    const user = {
      id: "rest-user-1",
      email: "rest-test@example.com",
    };
    const client = {
      id: "rest-client-1",
      clientId: "svc_rest_test_1",
    };

    mockDatabase.user.findFirst.mockResolvedValue(user as never);
    mockDatabase.serviceClient.findFirst.mockResolvedValue(client as never);

    const oboToken = generateOboJWT(
      user.id,
      user.email,
      client.id,
      ["user:read"], // This token doesn't have timelapse:write scope
      900,
    );

    const res = createRes();
    const req = createReq({
      method: "POST",
      query: { router: "timelapse", procedure: "createDraft" },
      headers: { authorization: `Bearer ${oboToken}` },
    });

    await restHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: "forbidden",
      error_description: "Missing required scope.",
    });
  });

  it("returns consistent success response format", async () => {
    mockDatabase.user.aggregate.mockResolvedValue({
      _count: { lastHeartbeat: 42 },
    } as never);

    const res = createRes();
    const req = createReq({
      method: "GET",
      query: { router: "global", procedure: "activeUsers" },
    });

    await restHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    expect(res.statusCode).toBe(200);
    const body = res.body as any;
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty("data");
    expect(body.data).toHaveProperty("count", 42);
    expect(body).not.toHaveProperty("error");
  });

  it("returns consistent error response format", async () => {
    const res = createRes();
    const req = createReq({
      method: "GET",
      query: { router: "user", procedure: "getDevices" },
    });

    await restHandler(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    expect(res.statusCode).toBe(401);
    const body = res.body as any;
    expect(body).toHaveProperty("error", "unauthorized");
    expect(body).toHaveProperty("error_description", "Authentication required.");
    expect(body).not.toHaveProperty("ok");
    expect(body).not.toHaveProperty("data");
  });
});