import { implement, isProcedure } from "@orpc/server";
import { compositeRouterContract } from "@hackclub/lapse-api";

import { policyNameOf } from "@/policy.js";
import type { Context } from "@/router.js";

import user from "@/routers/user.js";
import timelapse from "@/routers/timelapse.js";
import draftTimelapse from "@/routers/draftTimelapse.js";
import comment from "@/routers/comment.js";
import developer from "@/routers/developer.js";
import global from "@/routers/global.js";
import hackatime from "@/routers/hackatime.js";
import auth from "@/routers/auth.js";
import admin from "@/routers/admin.js";

/**
 * Refuses to start a server on which some procedure isn't guarded by its own policy. A handler never checks who is
 * calling it, so one that was written without `.use(authorize("its.own.name"))` would be open to everyone.
 */
export function assertEveryProcedureIsAuthorized(node: unknown, path: string[] = []) {
    if (isProcedure(node)) {
        const name = path.join(".");
        const guards = node["~orpc"].middlewares.map(policyNameOf).filter(x => x !== undefined);

        if (guards.length !== 1 || guards[0] !== name)
            throw new Error(`Procedure ${name} must use authorize("${name}"), exactly once (found: ${guards.join(", ") || "nothing"}).`);

        return;
    }

    for (const [key, value] of Object.entries(node as Record<string, unknown>))
        assertEveryProcedureIsAuthorized(value, [...path, key]);
}

/**
 * Every procedure of the API. Kept apart from `app.ts`, which starts the server as soon as it's imported, so that
 * the tests can call procedures without one.
 */
export const router = implement(compositeRouterContract)
    .$context<Context>()
    .router({
        user,
        timelapse,
        draftTimelapse,
        comment,
        developer,
        global,
        hackatime,
        auth,
        admin,
    });

assertEveryProcedureIsAuthorized(router);
