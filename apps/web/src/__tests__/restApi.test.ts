import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";
import path from "path";
import type { PrismaClient } from "@/generated/prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

process.env.JWT_SECRET ??= "test-secret";

const DATABASE_URL = process.env.DATABASE_URL ?? "";

let prisma: PrismaClient;
let restHandler: (req: NextApiRequest, res: NextApiResponse) => Promise<void>;
let oauthAuthorize: (
  req: NextApiRequest,
  res: NextApiResponse,
) => Promise<void>;
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
  Object.defineProperty(dbModule.database, "user", { value: prisma.user });
  Object.defineProperty(dbModule.database, "timelapse", {
    value: prisma.timelapse,
  });
  Object.defineProperty(dbModule.database, "knownDevice", {
    value: prisma.knownDevice,
  });

  restHandler = await import("@/pages/api/rest/[router]/[procedure]").then(
    (mod) => mod.default,
  );
  oauthAuthorize = await import("@/pages/api/oauth/authorize").then(
    (mod) => mod.default,
  );

  const authModule = await import("@/server/auth");
  generateJWT = authModule.generateJWT;
  generateOboJWT = authModule.generateOboJWT;
  hashServiceSecret = authModule.hashServiceSecret;
});

afterAll(async () => {
  if (!prisma) return;

  await prisma.serviceGrant.deleteMany({
    where: {
      serviceClient: {
        clientId: { startsWith: "svc_rest_test" },
      },
    },
  });

  await prisma.serviceClient.deleteMany({
    where: {
      clientId: { startsWith: "svc_rest_test" },
    },
  });

  await prisma.user.deleteMany({
    where: {
      email: { in: ["rest-test@example.com"] },
    },
  });

  await prisma.$disconnect();
});

describe("rest api", () => {
  it("allows access to public endpoints without auth", async () => {
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
  });

  it("supports OBO authentication with scopes", async () => {
    const user = await prisma.user.create({
      data: {
        email: "rest-test@example.com",
        handle: `restuser-${Date.now()}`,
        displayName: "REST Test User",
        profilePictureUrl: "https://example.com/avatar.png",
        bio: "",
        urls: [],
      },
    });

    const client = await prisma.serviceClient.create({
      data: {
        name: "REST Test App",
        clientId: `svc_rest_test_${Date.now()}`,
        clientSecretHash: hashServiceSecret("secret"),
        scopes: ["user:read"],
        redirectUris: ["https://example.com/callback"],
        createdByUserId: user.id,
      },
    });

    // 3. Create a grant
    await prisma.serviceGrant.create({
      data: {
        serviceClientId: client.id,
        userId: user.id,
        scopes: ["user:read"],
      },
    });

    // 4. Generate OBO token
    const oboToken = generateOboJWT(
      user.id,
      user.email,
      client.id,
      ["user:read"],
      900,
    );

    // 5. Test access with correct scope
    const successRes = createRes();
    const successReq = createReq({
      method: "GET",
      query: { router: "user", procedure: "getDevices" },
      headers: { authorization: `Bearer ${oboToken}` },
    });

    await restHandler(
      successReq as unknown as NextApiRequest,
      successRes as unknown as NextApiResponse,
    );
    expect(successRes.statusCode).toBe(200);

    // 6. Test access with missing scope
    const forbiddenRes = createRes();
    const forbiddenReq = createReq({
      method: "POST",
      query: { router: "timelapse", procedure: "createDraft" },
      headers: { authorization: `Bearer ${oboToken}` },
    });

    await restHandler(
      forbiddenReq as unknown as NextApiRequest,
      forbiddenRes as unknown as NextApiResponse,
    );
    expect(forbiddenRes.statusCode).toBe(403);
  });
});
