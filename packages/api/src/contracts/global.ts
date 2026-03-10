import z from "zod";

import { apiResult, LapseId } from "@/common";
import { UserDisplayName, UserHandle } from "@/contracts/user";
import { contract, NO_INPUT } from "@/internal";
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

export const globalRouterContract = {
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
        }))
};
