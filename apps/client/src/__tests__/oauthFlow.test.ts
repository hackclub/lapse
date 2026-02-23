import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";

import { setupEnvMock } from "./mocks/env";
import { setupDatabaseMock, mockDatabase, resetMockDatabase } from "./mocks/database";

setupDatabaseMock();
setupEnvMock();

let oauthAuthorize: (req: NextApiRequest, res: NextApiResponse) => Promise<void>;
let oauthToken: (req: NextApiRequest, res: NextApiResponse) => Promise<void>;
let generateJWT: (userId: string, email: string) => string;
let generateOAuthCode: (userId: string, clientId: string, scopes: string[], redirectUri: string, ttlSeconds: number) => string;
let hashServiceSecret: (secret: string) => string;

function createRes() {
  const headers: Record<string, string> = {};

  return {
    statusCode: 200,
    headers,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  };
}

function createReq(options: { method: string; body?: unknown; headers?: Record<string, string> }) {
  return {
    method: options.method,
    body: options.body,
    headers: options.headers ?? {},
  };
}

beforeEach(async () => {
  resetMockDatabase();
  oauthAuthorize = await import("@/pages/api/oauth/authorize").then(mod => mod.default);
  oauthToken = await import("@/pages/api/oauth/token").then(mod => mod.default);

  const authModule = await import("@/server/auth");
  generateJWT = authModule.generateJWT;
  generateOAuthCode = authModule.generateOAuthCode;
  hashServiceSecret = authModule.hashServiceSecret;
});

afterEach(() => {
  resetMockDatabase();
});

describe("oauth flow", () => {
  it("rejects invalid redirect URI", async () => {
    const user = {
      id: "oauth-user-1",
      email: "test@example.com",
    };

    const client = {
      id: "oauth-client-1",
      clientId: "svc_test_1",
      clientSecretHash: hashServiceSecret("secret"),
      scopes: ["timelapse:read"],
      redirectUris: ["https://example.com/callback"],
      trustLevel: "UNTRUSTED",
      name: "Sample App",
    };

    mockDatabase.user.findFirst.mockResolvedValue(user as never);
    mockDatabase.serviceClient.findFirst.mockResolvedValue(client as never);

    const token = generateJWT(user.id, user.email);

    const authedRes = createRes();
    const authedReq = createReq({
      method: "POST",
      body: {
        client_id: client.clientId,
        redirect_uri: "https://example.com/other",
        scope: ["timelapse:read"],
        state: "state",
      },
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    await oauthAuthorize(
      authedReq as unknown as NextApiRequest,
      authedRes as unknown as NextApiResponse,
    );
    expect(authedRes.statusCode).toBe(400);
  });

  it("requires grant for token exchange", async () => {
    const user = {
      id: "oauth-user-2",
      email: "test2@example.com",
    };

    const client = {
      id: "oauth-client-2",
      clientId: "svc_test2",
      clientSecretHash: hashServiceSecret("secret"),
      scopes: ["timelapse:read"],
      redirectUris: ["https://example.com/callback"],
    };

    mockDatabase.serviceClient.findFirst.mockResolvedValue(client as never);
    mockDatabase.user.findFirst.mockResolvedValue(user as never);
    mockDatabase.serviceGrant.findFirst.mockResolvedValue(null as never);

    const authCode = generateOAuthCode(
      user.id,
      client.clientId,
      ["timelapse:read"],
      client.redirectUris[0],
      300,
    );

    const tokenRes = createRes();
    const tokenReq = createReq({
      method: "POST",
      body: {
        grant_type: "authorization_code",
        code: authCode,
        redirect_uri: client.redirectUris[0],
      },
      headers: {
        authorization: `Basic ${Buffer.from(`${client.clientId}:secret`).toString("base64")}`,
        "content-type": "application/json",
      },
    });

    await oauthToken(
      tokenReq as unknown as NextApiRequest,
      tokenRes as unknown as NextApiResponse,
    );
    
    expect(tokenRes.statusCode).toBe(403);
  });

  it("rejects OBO tokens with empty scopes", async () => {
    const user = {
      id: "oauth-user-3",
      email: "test3@example.com",
    };

    const client = {
      id: "oauth-client-3",
      clientId: "svc_test3",
      clientSecretHash: hashServiceSecret("secret"),
      scopes: ["timelapse:read"],
      redirectUris: ["https://example.com/callback"],
    };

    mockDatabase.user.findFirst.mockResolvedValue(user as never);
    mockDatabase.serviceClient.findFirst.mockResolvedValue(client as never);
    mockDatabase.serviceGrant.findFirst.mockResolvedValue({
      scopes: [""],
    } as never);

    const authModule = await import("@/server/auth");
    const emptyScopeToken = authModule.generateOboJWT(
      user.id,
      user.email,
      client.id,
      [""],
      900,
    );

    const res = createRes();
    const req = createReq({
      method: "POST",
      body: {
        client_id: client.clientId,
        redirect_uri: "https://example.com/callback",
        scope: ["timelapse:read"],
        state: "state",
      },
      headers: {
        authorization: `Bearer ${emptyScopeToken}`,
      },
    });

    await oauthAuthorize(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );

    expect(res.statusCode).toBe(401);
  });

  it("rejects duplicate scopes on consent", async () => {
    const user = {
      id: "oauth-user-4",
      email: "test4@example.com",
    };

    const client = {
      id: "oauth-client-4",
      clientId: "svc_test4",
      clientSecretHash: hashServiceSecret("secret"),
      scopes: ["timelapse:read", "snapshot:read"],
      redirectUris: ["https://example.com/callback"],
    };

    mockDatabase.user.findFirst.mockResolvedValue(user as never);
    mockDatabase.serviceClient.findFirst.mockResolvedValue(client as never);

    const userToken = generateJWT(user.id, user.email);

    const res = createRes();
    const req = createReq({
      method: "PUT",
      body: {
        client_id: client.clientId,
        redirect_uri: "https://example.com/callback",
        scope: ["timelapse:read", "timelapse:read"],
        state: "state",
        consent: true,
      },
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    });

    await oauthAuthorize(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );

    expect(res.statusCode).toBe(400);
  });

  it("rejects duplicate scopes on token exchange", async () => {
    const user = {
      id: "oauth-user-5",
      email: "test5@example.com",
    };

    const client = {
      id: "oauth-client-5",
      clientId: "svc_test5",
      clientSecretHash: hashServiceSecret("secret"),
      scopes: ["timelapse:read"],
      redirectUris: ["https://example.com/callback"],
    };

    const grant = {
      id: "grant-5",
      scopes: ["timelapse:read", "timelapse:read"],
    };

    mockDatabase.user.findFirst.mockResolvedValue(user as never);
    mockDatabase.serviceClient.findFirst.mockResolvedValue(client as never);
    mockDatabase.serviceGrant.findFirst.mockResolvedValue(grant as never);

    const authCode = generateOAuthCode(
      user.id,
      client.clientId,
      ["timelapse:read", "timelapse:read"],
      client.redirectUris[0],
      300,
    );

    const tokenRes = createRes();
    const tokenReq = createReq({
      method: "POST",
      body: {
        grant_type: "authorization_code",
        code: authCode,
        redirect_uri: client.redirectUris[0],
      },
      headers: {
        authorization: `Basic ${Buffer.from(`${client.clientId}:secret`).toString("base64")}`,
        "content-type": "application/json",
      },
    });

    await oauthToken(
      tokenReq as unknown as NextApiRequest,
      tokenRes as unknown as NextApiResponse,
    );

    expect(tokenRes.statusCode).toBe(400);
  });

  it("rejects OBO tokens for token exchange", async () => {
    const user = {
      id: "oauth-user-6",
      email: "test6@example.com",
    };

    const client = {
      id: "oauth-client-6",
      clientId: "svc_test6",
      clientSecretHash: hashServiceSecret("secret"),
      scopes: ["timelapse:read"],
      redirectUris: ["https://example.com/callback"],
    };

    const grant = {
      id: "grant-6",
      scopes: ["timelapse:read"],
    };

    mockDatabase.user.findFirst.mockResolvedValue(user as never);
    mockDatabase.serviceClient.findFirst.mockResolvedValue(client as never);
    mockDatabase.serviceGrant.findFirst.mockResolvedValue(grant as never);

    const authModule = await import("@/server/auth");
    const oboToken = authModule.generateOboJWT(
      user.id,
      user.email,
      client.id,
      ["timelapse:read"],
      900,
    );

    const tokenRes = createRes();
    const tokenReq = createReq({
      method: "POST",
      body: {
        grant_type: "authorization_code",
        code: oboToken,
        redirect_uri: client.redirectUris[0],
      },
      headers: {
        authorization: `Basic ${Buffer.from(`${client.clientId}:secret`).toString("base64")}`,
        "content-type": "application/json",
      },
    });

    await oauthToken(
      tokenReq as unknown as NextApiRequest,
      tokenRes as unknown as NextApiResponse,
    );

    expect(tokenRes.statusCode).toBe(400);
  });

  it("rejects OBO tokens with duplicate scopes", async () => {
    const user = {
      id: "oauth-user-8",
      email: "test8@example.com",
    };

    const client = {
      id: "oauth-client-8",
      clientId: "svc_test8",
      clientSecretHash: hashServiceSecret("secret"),
      scopes: ["timelapse:read"],
      redirectUris: ["https://example.com/callback"],
    };

    const grant = {
      id: "grant-8",
      scopes: ["timelapse:read"],
    };

    mockDatabase.user.findFirst.mockResolvedValue(user as never);
    mockDatabase.serviceClient.findFirst.mockResolvedValue(client as never);
    mockDatabase.serviceGrant.findFirst.mockResolvedValue(grant as never);

    const authModule = await import("@/server/auth");
    const oboToken = authModule.generateOboJWT(
      user.id,
      user.email,
      client.id,
      ["timelapse:read", "timelapse:read"],
      900,
    );

    const res = createRes();
    const req = createReq({
      method: "POST",
      body: {
        client_id: client.clientId,
        redirect_uri: "https://example.com/callback",
        scope: ["timelapse:read"],
      },
      headers: {
        authorization: `Bearer ${oboToken}`,
      },
    });

    await oauthAuthorize(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );

    expect(res.statusCode).toBe(401);
  });

  it("does not accept OBO tokens as user auth", async () => {
    const user = {
      id: "oauth-user-7",
      email: "test7@example.com",
    };

    const client = {
      id: "oauth-client-7",
      clientId: "svc_test7",
      clientSecretHash: hashServiceSecret("secret"),
      scopes: ["timelapse:read"],
      redirectUris: ["https://example.com/callback"],
    };

    const grant = {
      id: "grant-7",
      scopes: ["timelapse:read"],
    };

    mockDatabase.user.findFirst.mockResolvedValue(user as never);
    mockDatabase.serviceClient.findFirst.mockResolvedValue(client as never);
    mockDatabase.serviceGrant.findFirst.mockResolvedValue(grant as never);

    const authModule = await import("@/server/auth");
    const oboToken = authModule.generateOboJWT(
      user.id,
      user.email,
      client.id,
      ["timelapse:read"],
      900,
    );

    const res = createRes();
    const req = createReq({
      method: "POST",
      body: {
        client_id: client.clientId,
        redirect_uri: "https://example.com/callback",
        scope: ["timelapse:read"],
      },
      headers: {
        authorization: `Bearer ${oboToken}`,
        "content-type": "application/json",
      },
    });

    await oauthAuthorize(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );

    expect(res.statusCode).toBe(401);
  });

  it("rejects overly long state values", async () => {
    const user = {
      id: "oauth-user-9",
      email: "test9@example.com",
    };

    const client = {
      id: "oauth-client-9",
      clientId: "svc_test9",
      clientSecretHash: hashServiceSecret("secret"),
      scopes: ["timelapse:read"],
      redirectUris: ["https://example.com/callback"],
    };

    mockDatabase.user.findFirst.mockResolvedValue(user as never);
    mockDatabase.serviceClient.findFirst.mockResolvedValue(client as never);

    const userToken = generateJWT(user.id, user.email);

    const res = createRes();
    const req = createReq({
      method: "POST",
      body: {
        client_id: client.clientId,
        redirect_uri: "https://example.com/callback",
        scope: ["timelapse:read"],
        state: "x".repeat(300),
      },
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    });

    await oauthAuthorize(
      req as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );

    expect(res.statusCode).toBe(400);
  });

  it("rejects invalid scopes on token exchange", async () => {
    const user = {
      id: "oauth-user-10",
      email: "test10@example.com",
    };

    const client = {
      id: "oauth-client-10",
      clientId: "svc_test10",
      clientSecretHash: hashServiceSecret("secret"),
      scopes: ["timelapse:read"],
      redirectUris: ["https://example.com/callback"],
    };

    const grant = {
      id: "grant-10",
      scopes: ["timelapse:read"],
    };

    mockDatabase.user.findFirst.mockResolvedValue(user as never);
    mockDatabase.serviceClient.findFirst.mockResolvedValue(client as never);
    mockDatabase.serviceGrant.findFirst.mockResolvedValue(grant as never);

    const authCode = generateOAuthCode(
      user.id,
      client.clientId,
      ["timelapse:read", "invalid:scope"],
      client.redirectUris[0],
      300,
    );

    const tokenRes = createRes();
    const tokenReq = createReq({
      method: "POST",
      body: {
        grant_type: "authorization_code",
        code: authCode,
        redirect_uri: client.redirectUris[0],
      },
      headers: {
        authorization: `Basic ${Buffer.from(`${client.clientId}:secret`).toString("base64")}`,
        "content-type": "application/json",
      },
    });

    await oauthToken(
      tokenReq as unknown as NextApiRequest,
      tokenRes as unknown as NextApiResponse,
    );

    expect(tokenRes.statusCode).toBe(400);
  });
});
