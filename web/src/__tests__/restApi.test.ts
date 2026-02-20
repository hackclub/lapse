import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import { setupEnvMock } from "./mocks/env";
import { setupDatabaseMock, mockDatabase, resetMockDatabase } from "./mocks/database";

setupDatabaseMock();
setupEnvMock();

let restHandler: (req: NextApiRequest, res: NextApiResponse) => Promise<void>;
let generateOboJWT: (
    userId: string,
    email: string,
    actorId: string,
    scopes: string[],
    ttl: number,
) => string;

beforeEach(async () => {
    resetMockDatabase();
    restHandler = await import("@/pages/api/rest/[...trpc]").then(
        (mod) => mod.default,
    );

    const authModule = await import("@/server/auth");
    generateOboJWT = authModule.generateOboJWT;
});

afterEach(() => {
    vi.clearAllMocks();
    resetMockDatabase();
});

describe("rest api", () => {
    it("allows access to public endpoints without auth", async () => {
        mockDatabase.user.aggregate.mockResolvedValue({
            _count: { lastHeartbeat: 7 },
        } as never);

        const { req, res } = createMocks({
            method: "GET",
            url: "/api/rest/global/activeUsers",
            query: { trpc: ["global", "activeUsers"] },
        });

        await restHandler(
            req as unknown as NextApiRequest,
            res as unknown as NextApiResponse,
        );
        expect(res._getStatusCode()).toBe(200);
        expect(res._getJSONData()).toEqual({
            ok: true,
            data: { count: 7 },
        });
    });

    it("enforces authentication for protected endpoints", async () => {
        const { req, res } = createMocks({
            method: "GET",
            url: "/api/rest/user/getDevices",
            query: { trpc: ["user", "getDevices"] },
        });

        await restHandler(
            req as unknown as NextApiRequest,
            res as unknown as NextApiResponse,
        );
        expect(res._getStatusCode()).toBe(401);
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

        const { req, res } = createMocks({
            method: "GET",
            url: "/api/rest/user/getDevices",
            query: { trpc: ["user", "getDevices"] },
            headers: { authorization: `Bearer ${oboToken}` },
        });

        await restHandler(
            req as unknown as NextApiRequest,
            res as unknown as NextApiResponse,
        );
        expect(res._getStatusCode()).toBe(200);
        expect(res._getJSONData()).toEqual({
            ok: true,
            data: { devices: [] },
        });
    });

    it("returns consistent success response format", async () => {
        mockDatabase.user.aggregate.mockResolvedValue({
            _count: { lastHeartbeat: 42 },
        } as never);

        const { req, res } = createMocks({
            method: "GET",
            url: "/api/rest/global/activeUsers",
            query: { trpc: ["global", "activeUsers"] },
        });

        await restHandler(
            req as unknown as NextApiRequest,
            res as unknown as NextApiResponse,
        );
        expect(res._getStatusCode()).toBe(200);
        const body = res._getJSONData();
        expect(body.ok).toBe(true);
        expect(body).toHaveProperty("data");
        expect(body.data).toHaveProperty("count", 42);
    });
});
