import { z } from "zod";
import { implement } from "@orpc/server";
import { globalRouterContract, type GlobalStats, type GlobalStatsWeek, type LeaderboardUserEntry, MAX_DISPLAY_NAME_LENGTH } from "@hackclub/lapse-api";
import { daysAgo, descending } from "@hackclub/lapse-shared";

import { logMiddleware, type Context } from "@/router.js";
import { dtoPublicTimelapse } from "@/routers/timelapse.js";
import { apiOk } from "@/common.js";
import { database } from "@/db.js";
import { logError } from "@/logging.js";
import { actorHasAdminView } from "@/ownership.js";

const os = implement(globalRouterContract)
    .$context<Context>()
    .use(logMiddleware);

let leaderboardCacheUpdatedOn: Date | null = null;
let leaderboardCache: LeaderboardUserEntry[] = [];

const ACTIVE_USERS_EXPIRY_MS = 60 * 1000;

const STATS_CACHE_TTL_MS = 10 * 60 * 1000;
const STATS_WEEKS = 12;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

let statsCache: { expiresAt: number, stats: Promise<GlobalStats> } | null = null;

function startOfUtcWeek(date: Date) {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const daysSinceMonday = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - daysSinceMonday);
    return start;
}

async function computeStats(): Promise<GlobalStats> {
    const db = database();
    const now = new Date();
    const weekAgo = daysAgo(7);
    const firstWeekStart = startOfUtcWeek(now).getTime() - (STATS_WEEKS - 1) * WEEK_MS;
    const valid = { visibility: { not: "FAILED_PROCESSING" as const } };

    const [
        totalUsers,
        creators,
        newUsers,
        allTime,
        thisWeek,
        publicCount,
        unlistedCount,
        lookoutCount,
        hackatimeSynced,
        allTimelapses,
        drafts,
        lookoutDrafts,
        comments,
        recent
    ] = await Promise.all([
        db.user.count(),
        db.user.count({ where: { timelapses: { some: valid } } }),
        db.user.count({ where: { createdAt: { gte: weekAgo } } }),
        db.timelapse.aggregate({
            where: valid,
            _count: true,
            _sum: { duration: true },
            _avg: { duration: true },
            _max: { duration: true }
        }),
        db.timelapse.aggregate({
            where: { ...valid, createdAt: { gte: weekAgo } },
            _sum: { duration: true }
        }),
        db.timelapse.count({ where: { visibility: "PUBLIC" } }),
        db.timelapse.count({ where: { visibility: "UNLISTED" } }),
        db.timelapse.count({ where: { ...valid, lookoutSessionId: { not: null } } }),
        db.timelapse.count({ where: { ...valid, hackatimeProject: { not: null } } }),
        db.timelapse.count(),
        db.draftTimelapse.count({ where: { associatedTimelapseId: null } }),
        db.draftLookoutTimelapse.count(),
        db.comment.count(),
        db.timelapse.findMany({
            where: { ...valid, createdAt: { gte: new Date(firstWeekStart) } },
            select: { createdAt: true, duration: true }
        })
    ]);

    const weekly: GlobalStatsWeek[] = Array.from({ length: STATS_WEEKS }, (_, i) => ({
        weekStart: firstWeekStart + i * WEEK_MS,
        seconds: 0,
        timelapses: 0
    }));

    for (const timelapse of recent) {
        const week = weekly[Math.floor((timelapse.createdAt.getTime() - firstWeekStart) / WEEK_MS)];
        if (!week)
            continue;

        week.seconds += timelapse.duration;
        week.timelapses++;
    }

    const published = allTime._count;

    return {
        generatedAt: now.getTime(),
        users: {
            total: totalUsers,
            creators,
            newThisWeek: newUsers
        },
        time: {
            totalSeconds: allTime._sum.duration ?? 0,
            thisWeekSeconds: thisWeek._sum.duration ?? 0,
            averageTimelapseSeconds: allTime._avg.duration ?? 0,
            longestTimelapseSeconds: allTime._max.duration ?? 0
        },
        timelapses: {
            published,
            public: publicCount,
            unlisted: unlistedCount,
            lookout: lookoutCount,
            browser: published - lookoutCount,
            hackatimeSynced
        },
        recordings: {
            started: allTimelapses + drafts + lookoutDrafts,
            drafts: drafts + lookoutDrafts
        },
        comments,
        weekly
    };
}

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
                        // Clamp on read like the user DTO does: a legacy display name over the contract max
                        // would fail output validation and 500 the entire leaderboard for everyone.
                        displayName: user.displayName.slice(0, MAX_DISPLAY_NAME_LENGTH) || "User",
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
            // Admins see every timelapse, including unlisted, failed, and still-processing ones, so they can moderate.
            const isAdminView = actorHasAdminView(req.context.actor);

            const timelapses = await database().timelapse.findMany({
                where: isAdminView ? {} : { visibility: "PUBLIC", associatedJobId: null },
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
        }),

    stats: os.stats
        .handler(async () => {
            if (statsCache == null || statsCache.expiresAt <= Date.now()) {
                const stats = computeStats();
                statsCache = { expiresAt: Date.now() + STATS_CACHE_TTL_MS, stats };
                stats.catch(() => { statsCache = null; });
            }

            return apiOk({ stats: await statsCache.stats });
        }),

    maintenance: os.maintenance
        .handler(async (req) => {
            const maintenance = await database().maintenance.findFirst();

            return apiOk({
                maintenance: maintenance && {
                    startsAt: maintenance.startsAt.getTime(),
                    endsAt: maintenance.endsAt.getTime()
                }
            });
        })
});
