import "@/server/allow-only-server";

import { z } from "zod";

import { apiResult, apiErr, apiOk } from "@/shared/common";

import { router, protectedProcedure, publicProcedure } from "@/server/trpc";
import { logError, logRequest } from "@/server/serverCommon";
import { database } from "@/server/db";
import { HackatimeOAuthApi } from "@/server/hackatime";
import { dtoTimelapse, TIMELAPSE_INCLUDES, TimelapseSchema } from "@/server/routers/api/timelapse";

/**
 * Represents a Hackatime project of a given user.
 */
export type HackatimeProject = z.infer<typeof HackatimeProjectSchema>;
export const HackatimeProjectSchema = z.object({
    name: z.string(),
    totalSeconds: z.number()
});

export default router({
    allProjects: protectedProcedure(["user:read"])
        .summary("Gets all Hackatime projects from the user's Hackatime account.")
        .input(z.object({}))
        .output(apiResult({
            projects: z.array(HackatimeProjectSchema)
        }))
        .query(async (req) => {
            logRequest("hackatime/allProjects", req);
            
            const dbUser = await database.user.findFirst({
                where: { id: req.ctx.user.id }
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
                logError("user.getAllHackatimeProjects", "Failed to fetch Hackatime projects", { error, userId: req.ctx.user.id });
                return apiOk({ projects: [] });
            }
        }),

    timelapsesForProject: publicProcedure("GET", "/hackatime/timelapsesForProject")
        .summary("Gets the timelapses of a given Hackatime user associated with the given Hackatime project key.")
        .input(z.object({
            hackatimeUserId: z.number().min(1)
                .describe("The Hackatime user ID of the Lapse user that should be the subject of this API call."),

            projectKey: z.string().min(1).max(256)
                .describe("The exact, case-sensitive Hackatime project key to query.")
        }))
        .output(apiResult({
            count: z.number()
                .describe(`
                    The number of timelapses made by the user associated with the project key. This number may be greater than \`timelapses\`
                    if the API request was unauthenticated and the user has unlisted timelapses associated with the key.
                `),

            timelapses: z.array(TimelapseSchema)
                .describe("The timelapses made by the user associated with the project key.")
        }))
        .query(async (req) => {
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
                timelapses: timelapses.map(x => dtoTimelapse(x, req.ctx.user))
            });
        })
});
