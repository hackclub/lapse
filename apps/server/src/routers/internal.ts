import { z } from "zod";
import { implement, os } from "@orpc/server";
import { globalRouterContract, type LeaderboardUserEntry } from "@hackclub/lapse-api";
import { daysAgo, descending } from "@hackclub/lapse-shared";

import { logMiddleware, type Context } from "@/router.js";
import { dtoPublicTimelapse } from "@/routers/timelapse.js";
import { apiOk } from "@/common.js";
import { database } from "@/db.js";
import { logError } from "@/logging.js";

let leaderboardCacheUpdatedOn: Date | null = null;
let leaderboardCache: LeaderboardUserEntry[] = [];

const ACTIVE_USERS_EXPIRY_MS = 60 * 1000;

export default os
    .$context<Context>()
    .use(logMiddleware)
    .router({
        /**
         * Used as an OAuth callback URL from Hackatime.
         */
        handleHackatimeAuth: os.route({
            method: "GET",
            path: "/internal/handleHackatimeAuth",
            inputStructure: "detailed"
        })
            .input(z.object({
                query: z.object({
                    code: z.string(),
                    error: z.string(),
                    state: z.string()
                })
            }))
            .handler(async (req) => {

            })
    });
