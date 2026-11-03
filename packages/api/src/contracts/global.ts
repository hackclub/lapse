import z from "zod";
import { oc } from "@orpc/contract";

import { apiResult, LapseDate, LapseId } from "@/common";
import { UserDisplayName, UserHandle } from "@/contracts/user";
import { contract, NO_INPUT } from "@/internal";
import { ROUTER_TAGS } from "@/tags";
import { TimelapseSchema } from "@/contracts/timelapse";

/**
 * Represents an entry on the global Lapse leaderboard. This is a subset of user information,
 * alongside leaderboard-specific data.
 */
export type LeaderboardUserEntry = z.infer<typeof LeaderboardUserEntrySchema>;
export const LeaderboardUserEntrySchema = z.object({
    id: LapseId,
    handle: UserHandle,
    displayName: UserDisplayName,
    secondsThisWeek: z.number().nonnegative(),
    pfp: z.url()
});

/**
 * A scheduled maintenance window. While one is active, Lapse is unavailable to everyone but administrators.
 */
export type MaintenanceWindow = z.infer<typeof MaintenanceWindowSchema>;
export const MaintenanceWindowSchema = z.object({
    startsAt: LapseDate,
    endsAt: LapseDate
});

/**
 * The amount of time recorded and timelapses published within a single week.
 */
export type GlobalStatsWeek = z.infer<typeof GlobalStatsWeekSchema>;
export const GlobalStatsWeekSchema = z.object({
    weekStart: LapseDate,
    seconds: z.number().nonnegative(),
    timelapses: z.number().nonnegative()
});

/**
 * Aggregate, anonymous statistics about Lapse as a whole.
 */
export type GlobalStats = z.infer<typeof GlobalStatsSchema>;
export const GlobalStatsSchema = z.object({
    generatedAt: LapseDate,
    users: z.object({
        total: z.number().nonnegative(),
        creators: z.number().nonnegative(),
        newThisWeek: z.number().nonnegative()
    }),
    time: z.object({
        totalSeconds: z.number().nonnegative(),
        thisWeekSeconds: z.number().nonnegative(),
        averageTimelapseSeconds: z.number().nonnegative(),
        longestTimelapseSeconds: z.number().nonnegative()
    }),
    timelapses: z.object({
        published: z.number().nonnegative(),
        public: z.number().nonnegative(),
        unlisted: z.number().nonnegative(),
        lookout: z.number().nonnegative(),
        browser: z.number().nonnegative(),
        hackatimeSynced: z.number().nonnegative()
    }),
    recordings: z.object({
        started: z.number().nonnegative(),
        drafts: z.number().nonnegative()
    }),
    comments: z.number().nonnegative(),
    weekly: z.array(GlobalStatsWeekSchema)
});

export const globalRouterContract = oc.tag(ROUTER_TAGS.global).router({
    weeklyLeaderboard: contract("GET", "/global/weeklyLeaderboard")
        .route({ description: "Returns the users that have the most Lapse time logged in the past 7 days." })
        .input(NO_INPUT)
        .output(apiResult({
            leaderboard: z.array(LeaderboardUserEntrySchema)
        })),

    recentTimelapses: contract("GET", "/global/recentTimelapses")
        .route({ description: "Returns the most recent public timelapses at the time of the API call. Administrators calling through the canonical client also receive unlisted, failed, and still-processing timelapses." })
        .input(NO_INPUT)
        .output(apiResult({
            timelapses: z.array(TimelapseSchema)
        })),

    activeUsers: contract("GET", "/global/activeUsers")
        .route({ description: "Returns the number of active users that have sent a heartbeat in the last 60s." })
        .input(NO_INPUT)
        .output(apiResult({
            count: z.number().nonnegative()
        })),

    stats: contract("GET", "/global/stats")
        .route({ description: "Returns aggregate, anonymous statistics about Lapse. The result may be cached for a few minutes." })
        .input(NO_INPUT)
        .output(apiResult({
            stats: GlobalStatsSchema
        })),

    maintenance: contract("GET", "/global/maintenance")
        .route({ description: "Returns the active maintenance window, or `null` if Lapse isn't under maintenance." })
        .input(NO_INPUT)
        .output(apiResult({
            maintenance: MaintenanceWindowSchema.nullable()
        }))
});
