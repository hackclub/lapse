import "@/server/allow-only-server";

import z from "zod";

import { apiResult, daysAgo, descending, apiOk } from "@/shared/common";

import { publicProcedure, router } from "@/server/trpc";
import { logError } from "@/server/serverCommon";
import { dtoPublicTimelapse, TimelapseSchema } from "@/server/routers/api/timelapse";
import { UserDisplayName, UserHandle } from "@/server/routers/api/user";
import { PublicId } from "@/server/routers/common";
import { database } from "@/server/db";

export type LeaderboardUserEntry = z.infer<typeof LeaderboardUserEntrySchema>;
export const LeaderboardUserEntrySchema = z.object({
    id: PublicId,
    handle: UserHandle,
    displayName: UserDisplayName,
    secondsThisWeek: z.number().nonnegative(),
    pfp: z.url()
});

let leaderboardCacheUpdatedOn: Date | null = null;
let leaderboardCache: LeaderboardUserEntry[] = [];

const ACTIVE_USERS_EXPIRY_MS = 60 * 1000;

export default router({
    weeklyLeaderboard: publicProcedure("GET", "/global/weeklyLeaderboard")
        .summary("Returns the users that have the most Lapse time logged in the past 7 days.")
        .input(z.object({}))
        .output(apiResult({
            leaderboard: z.array(LeaderboardUserEntrySchema)
        }))
        .query(async () => {
            const now = new Date();

            if (
                leaderboardCacheUpdatedOn != null &&
                leaderboardCacheUpdatedOn.getDate() == now.getDate()
            ) {
                return apiOk({ leaderboard: leaderboardCache });
            }

            const aggregates = await database.timelapse.groupBy({
                by: ["ownerId"],
                where: {
                    createdAt: {
                        gte: daysAgo(7)
                    }
                },
                _sum: { duration: true },
                orderBy: { _sum: { duration: "desc" } },
                take: 10
            });

            const users = await database.user.findMany({
                where: { id: { in: aggregates.map(x => x.ownerId) } },
                select: {
                    id: true,
                    handle: true,
                    displayName: true,
                    profilePictureUrl: true
                }
            });
            
            const leaderboard: LeaderboardUserEntry[] = users
                .map(user => {
                    const aggregate = aggregates.find(x => x.ownerId == user.id);
                    if (!aggregate || aggregate._sum.duration === null) {
                        logError("stats", `No aggregate found for user ID ${user.id} when assembling leaderboard.`);
                        return null;
                    }

                    return {
                        id: user.id,
                        handle: user.handle,
                        displayName: user.displayName,
                        pfp: user.profilePictureUrl,
                        secondsThisWeek: aggregate._sum.duration
                    } satisfies LeaderboardUserEntry;
                })
                .filter(x => x != null)
                .toSorted(descending(x => x.secondsThisWeek));

            leaderboardCacheUpdatedOn = new Date();
            leaderboardCache = leaderboard;
            return apiOk({ leaderboard });
        }),

    recentTimelapses: publicProcedure("GET", "/global/recentTimelapses")
        .summary("Returns the most recent public timelapses at the time of the API call.")
        .input(z.object({}))
        .output(apiResult({
            timelapses: z.array(TimelapseSchema)
        }))
        .query(async () => {
            const timelapses = await database.timelapse.findMany({
                where: { isPublished: true, visibility: "PUBLIC" },
                orderBy: { createdAt: "desc" },
                include: {
                    owner: true,
                    comments: { include: { author: true } }
                },
                take: 50
            });

            return apiOk({
                timelapses: timelapses.map(dtoPublicTimelapse)
            });
        }),

    activeUsers: publicProcedure("GET", "/global/activeUsers")
        .summary("Returns the number of active users that have sent a heartbeat in the last 60s.")
        .input(z.object({}))
        .output(apiResult({
            count: z.number().nonnegative()
        }))
        .query(async () => {
            const res = await database.user.aggregate({
                _count: { lastHeartbeat: true },
                where: {
                    lastHeartbeat: { gt: new Date(new Date().getTime() - ACTIVE_USERS_EXPIRY_MS) }
                }
            });

            return apiOk({ count: res._count.lastHeartbeat });
        })
});
