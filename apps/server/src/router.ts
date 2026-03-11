import type { FastifyRequest } from "fastify";
import { ORPCError, os } from "@orpc/server";
import { permissionLevelOrdinal, type LapseOAuthScope, type PermissionLevel } from "@hackclub/lapse-api";
import type { RequestHeadersPluginContext, ResponseHeadersPluginContext } from "@orpc/server/plugins";

import type * as db from "@/generated/prisma/client.js";

import type { ExternalActor, UserActor } from "@/ownership.js";
import { logRequest } from "@/logging.js";

/**
 * Represents Lapse-specific server-side information about an incoming API request.
 */
export interface Context extends
    ResponseHeadersPluginContext, // resHeaders
    RequestHeadersPluginContext // reqHeaders
{
    req: FastifyRequest;
    
    /**
     * The actor that is making the API request. `null` if the request is unauthenticated.
     */
    actor: ExternalActor | null;

    /** 
     * **Extracted from `actor`.** The authenticated user, or `null` if the actor is a program key or unauthenticated.
     */
    user: db.User | null;

    /**
     * **Extracted from `scopes`.** The scopes granted to the authenticated actor, or [] if unauthenticated.
     */
    scopes: LapseOAuthScope[];
}

/**
 * Same as `Context`, but specifies that a user *must* be authenticated.
 */
export interface ProtectedContext extends Context {
    actor: UserActor;
    user: db.User;
    scopes: LapseOAuthScope[];
}

/**
 * Logs each oRPC request.
 */
export const logMiddleware = os
    .$context<Context>()
    .middleware(async ({ context, next }, input) => {
        if (
            typeof input === "object" && input != null &&
            ("body" in input && "headers" in input)
        ) {
            input = input["body"];
        }

        logRequest(context.req.url.split("?")[0], input, context.user);
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
            const actor = context.actor;

            if (
                !actor ||
                actor.kind !== "USER" ||
                ( minimumLevel && (permissionLevelOrdinal(actor.user.permissionLevel) < permissionLevelOrdinal(minimumLevel)) )
            ) {
                throw new ORPCError("UNAUTHORIZED");
            }

            return next<ProtectedContext>({
                context: { ...context, actor, user: actor.user, scopes: actor.scopes }
            });
        });
}

/**
 * An oRPC middleware that specifies that an authenticated user has to posess the scopes in `scopes`. This middleware is
 * intended to be used after invoking `requiredAuth`.
 */
export function requiredScopes(...scopes: LapseOAuthScope[]) {
    return os
        .$context<ProtectedContext>()
        .middleware(async ({ context, next }) => {
            if (!context.scopes.includes("elevated")) {
                for (const scope of scopes) {
                    if (!context.scopes.includes(scope))
                        throw new ORPCError("UNAUTHORIZED", {
                            message: `Missing required scope "${scope}".`
                        });
                }
            }

            return next({ context });
        });
}
