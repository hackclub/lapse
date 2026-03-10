import type { FastifyRequest } from "fastify";
import { ORPCError, os } from "@orpc/server";
import { permissionLevelOrdinal, type LapseOAuthScope, type LapseProgramScope, type PermissionLevel, type User } from "@hackclub/lapse-api";
import type { RequestHeadersPluginContext, ResponseHeadersPluginContext } from "@orpc/server/plugins";

import * as db from "@/generated/prisma/client.js";

import type { AuthenticatedProgramKey } from "@/oauth.js";
import { logRequest } from "@/logging.js";

/**
 * Represents Lapse-specific server-side information about an incoming API request.
 */
export interface Context extends
    ResponseHeadersPluginContext, // resHeaders
    RequestHeadersPluginContext // reqHeaders
{
    user: db.User | null;
    scopes: LapseOAuthScope[];
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
            const { req, user, scopes } = context;

            if (
                !user ||
                ( minimumLevel && (permissionLevelOrdinal(user.permissionLevel) < permissionLevelOrdinal(minimumLevel)) )
            ) {
                throw new ORPCError("UNAUTHORIZED");
            }
            

            return next<ProtectedContext>({
                context: { req, user, scopes }
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

/**
 * Represents server-side information about an incoming program API request,
 * authenticated via a program key rather than a user token.
 */
export interface ProgramKeyContext extends
    ResponseHeadersPluginContext,
    RequestHeadersPluginContext
{
    programKey: AuthenticatedProgramKey | null;
    req: FastifyRequest;
}

/**
 * Same as `ProgramKeyContext`, but specifies that a program key *must* be present.
 */
export interface ProtectedProgramKeyContext extends ProgramKeyContext {
    programKey: AuthenticatedProgramKey;
}

/**
 * Logs each oRPC request for the program API.
 */
export const programLogMiddleware = os
    .$context<ProgramKeyContext>()
    .middleware(async ({ context, next }, input) => {
        if (
            typeof input === "object" && input != null &&
            ("body" in input && "headers" in input)
        ) {
            input = input["body"];
        }

        logRequest(context.req.url.split("?")[0], input, null);
        return next({ context });
    });

/**
 * An oRPC middleware that ensures a valid program key is present on the request.
 */
export function requiredProgramKey() {
    return os
        .$context<ProgramKeyContext>()
        .middleware(async ({ context, next }) => {
            if (!context.programKey)
                throw new ORPCError("UNAUTHORIZED");

            return next<ProtectedProgramKeyContext>({
                context: { ...context, programKey: context.programKey }
            });
        });
}

/**
 * An oRPC middleware that checks whether the authenticated program key has the required scopes.
 * Intended to be used after `requiredProgramKey`.
 */
export function requiredProgramScopes(...scopes: LapseProgramScope[]) {
    return os
        .$context<ProtectedProgramKeyContext>()
        .middleware(async ({ context, next }) => {
            for (const scope of scopes) {
                if (!context.programKey.scopes.includes(scope))
                    throw new ORPCError("UNAUTHORIZED", {
                        message: `Missing required program scope "${scope}".`
                    });
            }

            return next({ context });
        });
}
