import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";

import { env } from "@/env.js";

export const ADMIN_ROUTES = {
    detections: "/api/admin/detections",
    userSearch: "/api/admin/users/search",
    userTimelapses: "/api/admin/users/timelapses"
} as const;

export const ADMIN_ROUTE_PATHS: Set<string> = new Set(Object.values(ADMIN_ROUTES));

export type AdminReply<T> = { statusCode: number; body: T | { error: string } };

export function authenticatedWithAdminKey(header: string | undefined, key: string): boolean {
    const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
    const suppliedBuffer = Buffer.from(supplied, "utf8");
    const keyBuffer = Buffer.from(key, "utf8");
    return suppliedBuffer.length === keyBuffer.length
        && timingSafeEqual(suppliedBuffer, keyBuffer);
}

export function registerAdminRoute<T>(
    server: FastifyInstance,
    path: (typeof ADMIN_ROUTES)[keyof typeof ADMIN_ROUTES],
    handle: (body: unknown) => Promise<AdminReply<T>>
): void {
    server.post(path, async (request, reply) => {
        const key = env.LAPSE_ADMIN_API_KEY;
        if (!key)
            return reply.code(503).send({ error: "This admin API is not configured" });
        if (!authenticatedWithAdminKey(request.headers.authorization, key))
            return reply.code(401).send({ error: "Unauthorized" });

        const { statusCode, body } = await handle(request.body);
        return reply.code(statusCode).send(body);
    });
}
