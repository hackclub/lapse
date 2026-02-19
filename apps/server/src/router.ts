import type { FastifyRequest } from "fastify";
import { ORPCError, os } from "@orpc/server";
import { permissionLevelOrdinal, type PermissionLevel, type User } from "@hackclub/lapse-api";
import type { ResponseHeadersPluginContext } from "@orpc/server/plugins";

import * as db from "@/generated/prisma/client.js";

import { logRequest } from "@/logging.js";

/**
 * Represents Lapse-specific server-side information about an incoming API request.
 */
export interface Context extends ResponseHeadersPluginContext {
    user: db.User | null;
    req: FastifyRequest;
}

/**
 * Same as `Context`, but specifies that a user *must* be authenticated.
 */
export interface ProtectedContext extends Context {
    user: db.User;
}

/**
 * Logs each oRPC request.
 */
export const logMiddleware = os
    .$context<Context>()
    .middleware(async ({ context, next }, input) => {
        logRequest(context.req.url, input, context.user);
        return next({ context });
    });

/**
 * An oRPC middleware that specifies that a user _must_ be authenticated. Additionally, if `minimumLevel` is specified, ensures that
 * the authenticated user has a certain degree of authority.
 */
export function requiredAuth(minimumLevel?: PermissionLevel) {
    return os
        .$context<Context>()
        .middleware(async ({ context, next }) => {
            const { req, user } = context;

            if (
                !user ||
                ( minimumLevel && (permissionLevelOrdinal(user.permissionLevel) < permissionLevelOrdinal(minimumLevel)) )
            ) {
                throw new ORPCError("UNAUTHORIZED");
            }
            

            return next<ProtectedContext>({
                context: { req, user }
            });
        });
}
