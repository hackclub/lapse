import z from "zod";

import { apiResult } from "@/common";
import { contract, NO_INPUT } from "@/internal";
import { TimelapseSchema } from "@/contracts/timelapse";

/**
 * Represents a Hackatime project of a given user.
 */
export type HackatimeProject = z.infer<typeof HackatimeProjectSchema>;
export const HackatimeProjectSchema = z.object({
    name: z.string(),
    totalSeconds: z.number()
});

export const hackatimeRouterContract = {
    allProjects: contract()
        .route({ description: "Gets all Hackatime projects from the user's Hackatime account." })
        .input(NO_INPUT)
        .output(apiResult({
            projects: z.array(HackatimeProjectSchema)
        })),

     timelapsesForProject: contract("GET", "/hackatime/timelapsesForProject")
        .route({ description: "Gets the timelapses of a given Hackatime user associated with the given Hackatime project key." })
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
        })),
};
