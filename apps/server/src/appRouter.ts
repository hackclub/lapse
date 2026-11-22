import { implement } from "@orpc/server";
import { compositeRouterContract } from "@hackclub/lapse-api";

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
