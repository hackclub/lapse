import { z } from "zod";
import { implement } from "@orpc/server";
import { globalRouterContract, type LeaderboardUserEntry } from "@hackclub/lapse-api";
import { daysAgo, descending } from "@hackclub/lapse-shared";

import { logMiddleware, type Context } from "@/router.js";
import { dtoPublicTimelapse } from "@/routers/timelapse.js";
import { apiOk } from "@/common.js";
import { database } from "@/db.js";
import { logError } from "@/logging.js";

const os = implement(globalRouterContract)
    .$context<Context>()
    .use(logMiddleware);

let leaderboardCacheUpdatedOn: Date | null = null;
let leaderboardCache: LeaderboardUserEntry[] = [];

const ACTIVE_USERS_EXPIRY_MS = 60 * 1000;

export default os.router({
    weeklyLeaderboard: os.weeklyLeaderboard
        .handler(async (req) => {
            const now = new Date();

            if (
                leaderboardCacheUpdatedOn != null &&
                leaderboardCacheUpdatedOn.getDate() == now.getDate()
            ) {
                return apiOk({ leaderboard: leaderboardCache });
            }

            const aggregates = await database().timelapse.groupBy({
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

            const users = await database().user.findMany({
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
                        logError(`No aggregate found for user ID ${user.id} when assembling leaderboard.`);
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

    recentTimelapses: os.recentTimelapses
        .handler(async (req) => {
            const timelapses = await database().timelapse.findMany({
                where: { visibility: "PUBLIC" },
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

    activeUsers: os.activeUsers
        .handler(async (req) => {
            const res = await database().user.aggregate({
                _count: { lastHeartbeat: true },
                where: {
                    lastHeartbeat: { gt: new Date(new Date().getTime() - ACTIVE_USERS_EXPIRY_MS) }
                }
            });

            return apiOk({ count: res._count.lastHeartbeat });
        })
});
