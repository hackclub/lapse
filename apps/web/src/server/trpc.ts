import "@/server/allow-only-server";

import { initTRPC, TRPCError } from "@trpc/server";
import { NextApiRequest, NextApiResponse } from "next";
import { z, ZodError } from "zod";
import { OpenApiMeta, OpenApiMethod } from "trpc-to-openapi";

import { getAuthenticatedUser } from "@/server/auth";
import { OAuthScope } from "@/shared/oauthScopes";

import type { ServiceClient, User } from "@/generated/prisma/client";

export interface Context {
    req: NextApiRequest;
    res: NextApiResponse;
    user: User | null;
    scopes: string[];
}

export interface ProtectedContext extends Context {
    user: User;
}

export async function createContext(opts: { req: NextApiRequest; res: NextApiResponse }): Promise<Context> {
    const user = await getAuthenticatedUser(opts.req);

    return {
        req: opts.req,
        res: opts.res,
        user,
        scopes: []
    };
}

const t = initTRPC.context<Context>().meta<OpenApiMeta>().create({
    errorFormatter({ shape, error }) {
        return {
            ...shape,
            data: {
                ...shape.data,
                zodError: error.cause instanceof ZodError ? z.treeifyError(error.cause) : null,
            },
        };
    },
});

export const router = t.router;
export const procedure = t.procedure;

/**
 * Defines a tRPC procedure that requires the user to be authenticated, also associating OpenAPI metadata with the procedure.
 * The procedure then needs to be given documentation via `.summary(...)`.
 */
export function protectedProcedure(
    requiredScopes: OAuthScope[] = [],
    method?: OpenApiMethod,
    path?: `/${string}`
) {
    const authedProc = t.procedure.use(async (opts) => {
        const { ctx } = opts;
        const scopes = ctx.scopes ?? [];

        if (!ctx.user)
            throw new TRPCError({
                code: "UNAUTHORIZED",
                message: "Authentication required",
            });

        if (requiredScopes.length > 0 && scopes.length > 0) {
            const missingScopes = requiredScopes.filter(scope => !scopes.includes(scope));
            if (missingScopes.length > 0) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "Missing required OAuth scope",
                });
            }
        }

        return opts.next({ ctx: { ...ctx, scopes, user: ctx.user } });
    });

    return {
        summary(summary: string) {
            if (method && path)
                return authedProc.meta({ openapi: { method, path, summary, protect: true } });

            return authedProc;
        }
    };
}

/**
 * Defines a tRPC procedure that does **not** require the user to be authenticated, also associating OpenAPI metadata with the procedure.
 * The procedure then needs to be given documentation via `.summary(...)`.
 */
export function publicProcedure(method?: OpenApiMethod, path?: `/${string}`) {
  return {
    summary(summary: string) {
      if (method && path)
        return procedure.meta({ openapi: { method, path, summary, protect: false } });

      return procedure;
    }
  };
}

/**
 * Defines a tRPC procedure that requires the user to be an admin, also associating OpenAPI metadata with the procedure.
 * The procedure then needs to be given documentation via `.summary(...)`.
 */
export function adminProcedure(
    method?: OpenApiMethod,
    path?: `/${string}`
) {
    const adminProc = t.procedure.use(async (opts) => {
        const { ctx } = opts;

        if (!ctx.user) {
            throw new TRPCError({
                code: "UNAUTHORIZED",
                message: "Authentication required",
            });
        }

        if (ctx.user.permissionLevel !== "ADMIN" && ctx.user.permissionLevel !== "ROOT") {
            throw new TRPCError({
                code: "FORBIDDEN",
                message: "Admin access required",
            });
        }

        return opts.next({ ctx: { ...ctx, user: ctx.user } });
    });

    return {
        summary(summary: string) {
            if (method && path)
                return adminProc.meta({ openapi: { method, path, summary, protect: true } });

            return adminProc;
        }
    };
}
