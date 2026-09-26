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

export const globalRouterContract = oc.tag(ROUTER_TAGS.global).router({
    weeklyLeaderboard: contract("GET", "/global/weeklyLeaderboard")
        .route({ description: "Returns the users that have the most Lapse time logged in the past 7 days." })
        .input(NO_INPUT)
        .output(apiResult({
            leaderboard: z.array(LeaderboardUserEntrySchema)
        })),

    recentTimelapses: contract("GET", "/global/recentTimelapses")
        .route({ description: "Returns the most recent public timelapses at the time of the API call." })
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

    maintenance: contract("GET", "/global/maintenance")
        .route({ description: "Returns the active maintenance window, or `null` if Lapse isn't under maintenance." })
        .input(NO_INPUT)
        .output(apiResult({
            maintenance: MaintenanceWindowSchema.nullable()
        }))
});
