import type { FastifyRequest } from "fastify";
import { os } from "@orpc/server";
import type { LapseOAuthScope, ProgramKeyScope } from "@hackclub/lapse-api";
import type { RequestHeadersPluginContext, ResponseHeadersPluginContext } from "@orpc/server/plugins";


import type { ExternalActor } from "@/ownership.js";
import { logRequest } from "@/logging.js";
import type * as safe from "@/secrets.js";

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
    user: safe.User | null;

    /**
     * **Extracted from `actor`.** The scopes granted to the authenticated actor, or [] if unauthenticated.
     */
    scopes: (LapseOAuthScope | ProgramKeyScope)[];
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

        logRequest(context.req.url.split("?")[0], input, context.actor);
        return next({ context });
    });
