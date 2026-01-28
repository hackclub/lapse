import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";
import path from "path";
import type { PrismaClient } from "@/generated/prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

process.env.JWT_SECRET ??= "test-secret";
process.env.S3_ENCRYPTED_BUCKET_NAME ??= "test";
process.env.S3_PUBLIC_BUCKET_NAME ??= "test";
process.env.S3_ENDPOINT ??= "test";
process.env.S3_ACCESS_KEY_ID ??= "test";
process.env.S3_SECRET_ACCESS_KEY ??= "test";
process.env.S3_PUBLIC_URL_ENCRYPTED ??= "https://example.com/encrypted";
process.env.S3_PUBLIC_URL_PUBLIC ??= "https://example.com/public";
process.env.PRIVATE_KEY_UPLOAD_KEY ??= "0123456789abcdef0123456789abcdef";
process.env.NEXT_PUBLIC_HACKATIME_CLIENT_ID ??= "test";
process.env.NEXT_PUBLIC_HACKATIME_URL ??= "https://example.com";
process.env.HACKATIME_REDIRECT_URI ??= "https://example.com/callback";
process.env.UPLOAD_TOKEN_PRIVATE_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.UPLOAD_TOKEN_IV ??= "0123456789abcdef0123456789abcdef";
process.env.NEXT_PUBLIC_SENTRY_DSN ??= "test";
process.env.SENTRY_ORG ??= "test";
process.env.SENTRY_PROJECT ??= "test";
process.env.SLACK_BOT_TOKEN ??= "test";

const DATABASE_URL = process.env.DATABASE_URL ?? "";

let prisma: PrismaClient;
let oauthAuthorize: (
  req: NextApiRequest,
  res: NextApiResponse,
) => Promise<void>;
let oauthToken: (req: NextApiRequest, res: NextApiResponse) => Promise<void>;
let generateJWT: (userId: string, email: string) => string;
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

function createReq(options: {
  method: string;
  body?: unknown;
  headers?: Record<string, string>;
}) {
  return {
    method: options.method,
    body: options.body,
    headers: options.headers ?? {},
  };
}

beforeAll(async () => {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is required for tests");

  const { PrismaClient } = await import("@/generated/prisma/client");
  const adapter = new PrismaPg({ connectionString: DATABASE_URL });
  prisma = new PrismaClient({ adapter });

  const dbModule = await import("@/server/db");
  Object.defineProperty(dbModule.database, "serviceClient", {
    value: prisma.serviceClient,
  });
  Object.defineProperty(dbModule.database, "serviceGrant", {
    value: prisma.serviceGrant,
  });
  Object.defineProperty(dbModule.database, "serviceTokenAudit", {
    value: prisma.serviceTokenAudit,
  });
  Object.defineProperty(dbModule.database, "serviceClientReview", {
    value: prisma.serviceClientReview,
  });
  Object.defineProperty(dbModule.database, "user", {
    value: prisma.user,
  });

  oauthAuthorize = await import("@/pages/api/oauth/authorize").then(
    (mod) => mod.default,
  );
  oauthToken = await import("@/pages/api/oauth/token").then(
    (mod) => mod.default,
  );

  const authModule = await import("@/server/auth");
  generateJWT = authModule.generateJWT;
  hashServiceSecret = authModule.hashServiceSecret;
});

afterAll(async () => {
  if (!prisma) {
    return;
  }

  await prisma.serviceTokenAudit.deleteMany({
    where: {
      serviceClient: {
        clientId: {
          startsWith: "svc_test",
        },
      },
    },
  });

  await prisma.serviceGrant.deleteMany({
    where: {
      serviceClient: {
        clientId: {
          startsWith: "svc_test",
        },
      },
    },
  });

  await prisma.serviceClientReview.deleteMany({
    where: {
      serviceClient: {
        clientId: {
          startsWith: "svc_test",
        },
      },
    },
  });

  await prisma.serviceClient.deleteMany({
    where: {
      clientId: {
        startsWith: "svc_test",
      },
    },
  });

  await prisma.user.deleteMany({
    where: {
      email: {
        in: [
          "test@example.com",
          "test2@example.com",
          "test3@example.com",
          "test4@example.com",
          "test5@example.com",
          "test6@example.com",
          "test7@example.com",
          "test8@example.com",
          "test9@example.com",
          "test10@example.com",
        ],
      },
    },
  });

  await prisma.$disconnect();
});

describe("oauth flow", () => {
  it("rejects invalid redirect URI", async () => {
    const user = await prisma.user.create({
      data: {
        email: "test@example.com",
        handle: `testuser-${Date.now()}`,
        displayName: "Test User",
        profilePictureUrl: "https://example.com/avatar.png",
        bio: "",
        urls: [],
      },
    });

    const client = await prisma.serviceClient.create({
      data: {
        name: "Sample App",
        description: "",
        homepageUrl: "https://example.com",
        iconUrl: "",
        clientId: `svc_test_${Date.now()}`,
        clientSecretHash: hashServiceSecret("secret"),
        scopes: ["timelapse:read"],
        redirectUris: ["https://example.com/callback"],
        trustLevel: "UNTRUSTED",
        createdByUserId: user.id,
      },
    });

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
    const user = await prisma.user.create({
      data: {
        email: "test2@example.com",
        handle: `testuser2-${Date.now()}`,
        displayName: "Test User 2",
        profilePictureUrl: "https://example.com/avatar.png",
        bio: "",
        urls: [],
      },
    });

    const client = await prisma.serviceClient.create({
      data: {
        name: "Verified App",
        description: "",
        homepageUrl: "https://example.com",
        iconUrl: "",
        clientId: `svc_test2_${Date.now()}`,
        clientSecretHash: hashServiceSecret("secret"),
        scopes: ["timelapse:read"],
        redirectUris: ["https://example.com/callback"],
        trustLevel: "UNTRUSTED",
        createdByUserId: user.id,
      },
    });

    const userToken = generateJWT(user.id, user.email);

    const tokenRes = createRes();
    const tokenReq = createReq({
      method: "POST",
      body: {
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: userToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
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
    const user = await prisma.user.create({
      data: {
        email: "test3@example.com",
        handle: `testuser3-${Date.now()}`,
        displayName: "Test User 3",
        profilePictureUrl: "https://example.com/avatar.png",
        bio: "",
        urls: [],
      },
    });

    const client = await prisma.serviceClient.create({
      data: {
        name: "Empty Scope App",
        description: "",
        homepageUrl: "https://example.com",
        iconUrl: "",
        clientId: `svc_test3_${Date.now()}`,
        clientSecretHash: hashServiceSecret("secret"),
        scopes: ["timelapse:read"],
        redirectUris: ["https://example.com/callback"],
        trustLevel: "UNTRUSTED",
        createdByUserId: user.id,
      },
    });

    await prisma.serviceGrant.create({
      data: {
        serviceClientId: client.id,
        userId: user.id,
        scopes: [""],
      },
    });

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
    const user = await prisma.user.create({
      data: {
        email: "test4@example.com",
        handle: `testuser4-${Date.now()}`,
        displayName: "Test User 4",
        profilePictureUrl: "https://example.com/avatar.png",
        bio: "",
        urls: [],
      },
    });

    const client = await prisma.serviceClient.create({
      data: {
        name: "Dup Scope App",
        description: "",
        homepageUrl: "https://example.com",
        iconUrl: "",
        clientId: `svc_test4_${Date.now()}`,
        clientSecretHash: hashServiceSecret("secret"),
        scopes: ["timelapse:read", "snapshot:read"],
        redirectUris: ["https://example.com/callback"],
        trustLevel: "UNTRUSTED",
        createdByUserId: user.id,
      },
    });

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
    const user = await prisma.user.create({
      data: {
        email: "test5@example.com",
        handle: `testuser5-${Date.now()}`,
        displayName: "Test User 5",
        profilePictureUrl: "https://example.com/avatar.png",
        bio: "",
        urls: [],
      },
    });

    const client = await prisma.serviceClient.create({
      data: {
        name: "Dup Exchange App",
        description: "",
        homepageUrl: "https://example.com",
        iconUrl: "",
        clientId: `svc_test5_${Date.now()}`,
        clientSecretHash: hashServiceSecret("secret"),
        scopes: ["timelapse:read"],
        redirectUris: ["https://example.com/callback"],
        trustLevel: "UNTRUSTED",
        createdByUserId: user.id,
      },
    });

    await prisma.serviceGrant.create({
      data: {
        serviceClientId: client.id,
        userId: user.id,
        scopes: ["timelapse:read", "timelapse:read"],
      },
    });

    const userToken = generateJWT(user.id, user.email);

    const tokenRes = createRes();
    const tokenReq = createReq({
      method: "POST",
      body: {
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        scope: "timelapse:read timelapse:read",
        subject_token: userToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
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
    const user = await prisma.user.create({
      data: {
        email: "test6@example.com",
        handle: `testuser6-${Date.now()}`,
        displayName: "Test User 6",
        profilePictureUrl: "https://example.com/avatar.png",
        bio: "",
        urls: [],
      },
    });

    const client = await prisma.serviceClient.create({
      data: {
        name: "OBO Token App",
        description: "",
        homepageUrl: "https://example.com",
        iconUrl: "",
        clientId: `svc_test6_${Date.now()}`,
        clientSecretHash: hashServiceSecret("secret"),
        scopes: ["timelapse:read"],
        redirectUris: ["https://example.com/callback"],
        trustLevel: "UNTRUSTED",
        createdByUserId: user.id,
      },
    });

    await prisma.serviceGrant.create({
      data: {
        serviceClientId: client.id,
        userId: user.id,
        scopes: ["timelapse:read"],
      },
    });

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
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: oboToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
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
    const user = await prisma.user.create({
      data: {
        email: "test8@example.com",
        handle: `testuser8-${Date.now()}`,
        displayName: "Test User 8",
        profilePictureUrl: "https://example.com/avatar.png",
        bio: "",
        urls: [],
      },
    });

    const client = await prisma.serviceClient.create({
      data: {
        name: "OBO Dup Scope App",
        description: "",
        homepageUrl: "https://example.com",
        iconUrl: "",
        clientId: `svc_test8_${Date.now()}`,
        clientSecretHash: hashServiceSecret("secret"),
        scopes: ["timelapse:read"],
        redirectUris: ["https://example.com/callback"],
        trustLevel: "UNTRUSTED",
        createdByUserId: user.id,
      },
    });

    await prisma.serviceGrant.create({
      data: {
        serviceClientId: client.id,
        userId: user.id,
        scopes: ["timelapse:read"],
      },
    });

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
    const user = await prisma.user.create({
      data: {
        email: "test7@example.com",
        handle: `testuser7-${Date.now()}`,
        displayName: "Test User 7",
        profilePictureUrl: "https://example.com/avatar.png",
        bio: "",
        urls: [],
      },
    });

    const client = await prisma.serviceClient.create({
      data: {
        name: "OBO Auth App",
        description: "",
        homepageUrl: "https://example.com",
        iconUrl: "",
        clientId: `svc_test7_${Date.now()}`,
        clientSecretHash: hashServiceSecret("secret"),
        scopes: ["timelapse:read"],
        redirectUris: ["https://example.com/callback"],
        trustLevel: "UNTRUSTED",
        createdByUserId: user.id,
      },
    });

    await prisma.serviceGrant.create({
      data: {
        serviceClientId: client.id,
        userId: user.id,
        scopes: ["timelapse:read"],
      },
    });

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
    const user = await prisma.user.create({
      data: {
        email: "test9@example.com",
        handle: `testuser9-${Date.now()}`,
        displayName: "Test User 9",
        profilePictureUrl: "https://example.com/avatar.png",
        bio: "",
        urls: [],
      },
    });

    const client = await prisma.serviceClient.create({
      data: {
        name: "State Size App",
        description: "",
        homepageUrl: "https://example.com",
        iconUrl: "",
        clientId: `svc_test9_${Date.now()}`,
        clientSecretHash: hashServiceSecret("secret"),
        scopes: ["timelapse:read"],
        redirectUris: ["https://example.com/callback"],
        trustLevel: "UNTRUSTED",
        createdByUserId: user.id,
      },
    });

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

  it("rejects overly long scope strings on token exchange", async () => {
    const user = await prisma.user.create({
      data: {
        email: "test10@example.com",
        handle: `testuser10-${Date.now()}`,
        displayName: "Test User 10",
        profilePictureUrl: "https://example.com/avatar.png",
        bio: "",
        urls: [],
      },
    });

    const client = await prisma.serviceClient.create({
      data: {
        name: "Scope Length App",
        description: "",
        homepageUrl: "https://example.com",
        iconUrl: "",
        clientId: `svc_test10_${Date.now()}`,
        clientSecretHash: hashServiceSecret("secret"),
        scopes: ["timelapse:read"],
        redirectUris: ["https://example.com/callback"],
        trustLevel: "UNTRUSTED",
        createdByUserId: user.id,
      },
    });

    await prisma.serviceGrant.create({
      data: {
        serviceClientId: client.id,
        userId: user.id,
        scopes: ["timelapse:read"],
      },
    });

    const userToken = generateJWT(user.id, user.email);

    const tokenRes = createRes();
    const tokenReq = createReq({
      method: "POST",
      body: {
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        scope: "x".repeat(600),
        subject_token: userToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
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
