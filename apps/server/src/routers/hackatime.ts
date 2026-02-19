import { z } from "zod";
import { implement } from "@orpc/server";
import { hackatimeRouterContract } from "@hackclub/lapse-api";

import { logMiddleware, requiredAuth, type Context } from "@/router.js";
import { dtoTimelapse, TIMELAPSE_INCLUDES } from "@/routers/timelapse.js";
import { apiOk } from "@/common.js";
import { database } from "@/db.js";
import { logError } from "@/logging.js";
import { apiErr } from "@/common.js";
import { HackatimeOAuthApi } from "@/hackatime.js";

const os = implement(hackatimeRouterContract)
    .$context<Context>()
    .use(logMiddleware);

export default os.router({
    allProjects: os.allProjects
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;
            
            const dbUser = await database.user.findFirst({
                where: { id: caller.id }
            });

            if (!dbUser)
                return apiErr("NOT_FOUND", "User not found");

            if (!dbUser.hackatimeId || !dbUser.hackatimeAccessToken)
                return apiErr("ERROR", "You must have a linked Hackatime account!");

            const oauthApi = new HackatimeOAuthApi(dbUser.hackatimeAccessToken);
            
            try {
                const projects = await oauthApi.getProjects();

                const filteredProjects = projects
                    .filter(p => typeof p.name === "string" && p.name.trim().length > 0)
                    .sort((a, b) => {
                        const aTime = a.most_recent_heartbeat ? new Date(a.most_recent_heartbeat).getTime() : 0;
                        const bTime = b.most_recent_heartbeat ? new Date(b.most_recent_heartbeat).getTime() : 0;
                        return bTime - aTime;
                    })
                    .map(p => ({
                        name: p.name,
                        totalSeconds: p.total_seconds
                    }));

                return apiOk({ projects: filteredProjects });
            }
            catch (error) {
                logError("user.getAllHackatimeProjects", "Failed to fetch Hackatime projects", { error, userId: caller.id });
                return apiOk({ projects: [] });
            }
        }),

    timelapsesForProject: os.timelapsesForProject
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            const subject = await database.user.findFirst({
                where: {
                    hackatimeId: req.input.hackatimeUserId.toString()
                }
            });

            if (!subject)
                return apiOk({ count: 0, timelapses: [] });

            const timelapses = await database.timelapse.findMany({
                include: TIMELAPSE_INCLUDES,
                where: {
                    ownerId: subject.id,
                    hackatimeProject: req.input.projectKey
                }
            });

            return apiOk({
                count: timelapses.length,
                timelapses: timelapses.map(x => dtoTimelapse(x, caller))
            });
        }),
});
