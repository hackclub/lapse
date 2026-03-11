import { z } from "zod";
import { implement } from "@orpc/server";
import { hackatimeRouterContract } from "@hackclub/lapse-api";

import { logMiddleware, requiredAuth, requiredScopes, requiredImplicitUser, type Context } from "@/router.js";
import { dtoOwnedTimelapse, dtoTimelapse, TIMELAPSE_INCLUDES } from "@/routers/timelapse.js";
import { apiOk } from "@/common.js";
import { database } from "@/db.js";
import { logError } from "@/logging.js";
import { apiErr } from "@/common.js";
import { HackatimeOAuthApi } from "@/hackatime.js";
import { maybe } from "@hackclub/lapse-shared";

const os = implement(hackatimeRouterContract)
    .$context<Context>()
    .use(logMiddleware);

export default os.router({
    allProjects: os.allProjects
        .use(requiredAuth())
        .use(requiredScopes("timelapse:read"))
        .use(requiredImplicitUser())
        .handler(async (req) => {
            const caller = req.context.user;
            
            const dbUser = await database().user.findFirst({
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
                logError("Failed to fetch Hackatime projects", { error, userId: caller.id });
                return apiOk({ projects: [] });
            }
        }),

    myTimelapsesForProject: os.myTimelapsesForProject
        .use(requiredAuth())
        .use(requiredScopes("timelapse:read"))
        .use(requiredImplicitUser())
        .handler(async (req) => {
            const caller = req.context.user;

            const timelapses = await database().timelapse.findMany({
                include: TIMELAPSE_INCLUDES,
                orderBy: { createdAt: "desc" },
                where: {
                    ownerId: caller.id,
                    hackatimeProject: req.input.projectKey,
                    visibility: { in: ["PUBLIC", "UNLISTED"] }
                }
            });

            return apiOk({
                count: timelapses.length,
                timelapses: timelapses.map(x => dtoOwnedTimelapse(x))
            });
        }),

    timelapsesForProject: os.timelapsesForProject
        .use(requiredAuth())
        .use(requiredScopes("timelapse:read"))
        .handler(async (req) => {
            const actor = req.context.actor;

            const subject = await database().user.findFirst({
                where: {
                    hackatimeId: req.input.hackatimeUserId.toString()
                }
            });

            if (!subject)
                return apiOk({ count: 0, timelapses: [] });

            const timelapses = await database().timelapse.findMany({
                include: TIMELAPSE_INCLUDES,
                orderBy: { createdAt: "desc" },
                where: {
                    ownerId: subject.id,
                    hackatimeProject: req.input.projectKey,
                    visibility: {
                        in: [
                            "PUBLIC",
                            ...maybe("UNLISTED" as const, actor.kind == "PROGRAM" || actor.user.id == subject.id)
                        ]
                    }
                }
            });

            return apiOk({
                count: timelapses.length,
                timelapses: timelapses.map(x => dtoTimelapse(x, req.context.actor))
            });
        }),
});
