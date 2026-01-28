import "@/server/allow-only-server";

import { z } from "zod";

import { apiResult, apiErr, apiOk } from "@/shared/common";

import { router, protectedProcedure } from "@/server/trpc";
import { logError, logRequest } from "@/server/serverCommon";
import { database } from "@/server/db";
import { HackatimeOAuthApi } from "@/server/hackatime";

/**
 * Represents a Hackatime project of a given user.
 */
export type HackatimeProject = z.infer<typeof HackatimeProjectSchema>;
export const HackatimeProjectSchema = z.object({
    name: z.string(),
    totalSeconds: z.number()
});

export default router({
    /**
     * Gets all Hackatime projects from the user's Hackatime account.
     */
    allProjects: protectedProcedure()
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
        })
});
