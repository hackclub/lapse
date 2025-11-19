import "../../allow-only-server";

import z from "zod";

import * as db from "../../../generated/prisma";
import { procedure, router } from "@/server/trpc";
import { apiResult, daysAgo, descending, ok } from "@/shared/common";
import { PublicUserSchema, UserDisplayName } from "./user";
import { logError } from "@/server/serverCommon";
import { dtoTimelapse, TimelapseSchema } from "./timelapse";
import { PublicId } from "../common";

export type LeaderboardUserEntry = z.infer<typeof LeaderboardUserEntrySchema>;
export const LeaderboardUserEntrySchema = z.object({
    id: PublicId,
    displayName: UserDisplayName,
    secondsThisWeek: z.number().nonnegative(),
    pfp: z.url()
});

let leaderboardCacheUpdatedOn: Date | null = null;
let leaderboardCache: LeaderboardUserEntry[] = [];

const database = new db.PrismaClient();

export default router({
    /**
     * Returns the users that have the most usage time in the past 7 days.
     */
    weeklyLeaderboard: procedure
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
                return ok({ leaderboard: leaderboardCache });
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
                        displayName: user.displayName,
                        pfp: user.profilePictureUrl,
                        secondsThisWeek: aggregate._sum.duration
                    } satisfies LeaderboardUserEntry;
                })
                .filter(x => x != null)
                .toSorted(descending(x => x.secondsThisWeek));

            leaderboardCacheUpdatedOn = new Date();
            leaderboardCache = leaderboard;
            return ok({ leaderboard });
        }),

    /**
     * Returns the most recent public timelapses at the time of the API call.
     */
    recentTimelapses: procedure
        .input(z.object({}))
        .output(apiResult({
            timelapses: z.array(TimelapseSchema)
        }))
        .query(async () => {
            const timelapses = await database.timelapse.findMany({
                where: { isPublished: true, visibility: "PUBLIC" },
                orderBy: { createdAt: "desc" },
                include: { owner: true },
                take: 50
            });

            return ok({
                timelapses: timelapses.map(dtoTimelapse)
            });
        }),
});
