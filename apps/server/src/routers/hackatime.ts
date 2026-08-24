import { z } from "zod";
import { implement } from "@orpc/server";
import { hackatimeRouterContract, type HackatimeProject } from "@hackclub/lapse-api";

import { logMiddleware, requiredAuth, requiredScopes, requiredImplicitUser, type Context } from "@/router.js";
import { dtoOwnedTimelapse, dtoTimelapse, TIMELAPSE_INCLUDES } from "@/routers/timelapse.js";
import { apiOk } from "@/common.js";
import { database } from "@/db.js";
import { logError } from "@/logging.js";
import { apiErr } from "@/common.js";
import { HackatimeApiError, HackatimeOAuthApi } from "@/hackatime.js";
import { maybe } from "@hackclub/lapse-shared";

import * as db from "@/generated/prisma/client.js";

/**
 * The user's Hackatime projects, most recently worked on first.
 *
 * Extracted from `allProjects` so the Lookout publish panel can offer the same picker. The panel is
 * authenticated by its own URL rather than by a signed-in user, so it cannot call the procedure.
 */
export async function hackatimeProjectsForUser(user: db.User): Promise<HackatimeProject[]> {
    if (!user.hackatimeId || !user.hackatimeAccessToken)
        return [];

    const oauthApi = new HackatimeOAuthApi(user.hackatimeAccessToken);
    const projects = await oauthApi.getProjects();

    return projects
        .filter(p => typeof p.name === "string" && p.name.trim().length > 0)
        .sort((a, b) => {
            const aTime = a.most_recent_heartbeat ? new Date(a.most_recent_heartbeat).getTime() : 0;
            const bTime = b.most_recent_heartbeat ? new Date(b.most_recent_heartbeat).getTime() : 0;
            return bTime - aTime;
        })
        .map(p => ({
            name: p.name,
            totalSeconds: p.total_seconds,
            languages: (p.languages ?? []).filter(x => typeof x === "string" && x.trim().length > 0)
        }));
}

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

            try {
                return apiOk({ projects: await hackatimeProjectsForUser(dbUser) });
            }
            catch (error) {
                logError("Failed to fetch Hackatime projects", { error, userId: caller.id });
                return apiOk({ projects: [] });
            }
        }),

    linkStatus: os.linkStatus
        .use(requiredAuth())
        .use(requiredScopes("timelapse:read"))
        .use(requiredImplicitUser())
        .handler(async (req) => {
            const caller = req.context.user;

            const dbUser = await database().user.findFirst({
                where: { id: caller.id }
            });

            if (!dbUser?.hackatimeId || !dbUser.hackatimeAccessToken)
                return apiOk({ needsRelink: false });

            const oauthApi = new HackatimeOAuthApi(dbUser.hackatimeAccessToken);

            try {
                await oauthApi.getProjects();
                return apiOk({ needsRelink: false });
            }
            catch (error) {
                // 403 is Hackatime refusing a token minted before we asked for `read`; 401 is one that has stopped
                // working altogether. Signing in again fixes both. Anything else is Hackatime's problem, not the
                // user's, and nagging them about it would not help.
                const status = error instanceof HackatimeApiError ? error.status : null;

                if (status !== 401 && status !== 403)
                    logError("Couldn't check the Hackatime link status", { error, userId: caller.id });

                return apiOk({ needsRelink: status === 401 || status === 403 });
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
        .handler(async (req) => {
            const actor = req.context.actor;

            const subject = await database().user.findFirst({
                where: {
                    hackatimeId: req.input.hackatimeUserId.toString()
                }
            });

            if (!subject)
                return apiOk({ count: 0, timelapses: [] });

            const isPrivilidged = (actor != null) && (
                (actor.kind == "PROGRAM" && actor.programKey.scopes.includes("timelapse:read")) ||
                (actor.kind == "USER" && actor.scopes.includes("timelapse:read"))
            );

            const timelapses = await database().timelapse.findMany({
                include: TIMELAPSE_INCLUDES,
                orderBy: { createdAt: "desc" },
                where: {
                    ownerId: subject.id,
                    hackatimeProject: req.input.projectKey,
                    visibility: {
                        in: [
                            "PUBLIC",
                            ...maybe("UNLISTED" as const, isPrivilidged)
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
