import { z } from "zod";

import { apiResult, LapseId, LapseDate } from "@/common";
import { contract, NO_INPUT } from "@/internal";
import { PublicUserSchema } from "@/contracts/user";

/**
 * Represents a user as seen through the Program API, including private fields.
 */
export type ProgramUser = z.infer<typeof ProgramUserSchema>;
export const ProgramUserSchema = PublicUserSchema.extend({
    email: z.string(),
    permissionLevel: z.string(),
    lastHeartbeat: LapseDate,
});

/**
 * Represents a timelapse as seen through the Program API.
 */
export type ProgramTimelapse = z.infer<typeof ProgramTimelapseSchema>;
export const ProgramTimelapseSchema = z.object({
    id: LapseId,
    name: z.string(),
    description: z.string(),
    visibility: z.string(),
    duration: z.number(),
    createdAt: LapseDate,
    ownerId: z.string(),
    ownerHandle: z.string(),
    hackatimeProject: z.string().nullable(),
    commentCount: z.number(),
});

/**
 * Represents a comment as seen through the Program API.
 */
export type ProgramComment = z.infer<typeof ProgramCommentSchema>;
export const ProgramCommentSchema = z.object({
    id: LapseId,
    content: z.string(),
    createdAt: LapseDate,
    authorId: z.string(),
    authorHandle: z.string(),
    timelapseId: z.string(),
});

/**
 * Represents an OAuth service client as seen through the Program API.
 */
export type ProgramServiceClient = z.infer<typeof ProgramServiceClientSchema>;
export const ProgramServiceClientSchema = z.object({
    id: z.string(),
    clientId: z.string(),
    name: z.string(),
    description: z.string(),
    homepageUrl: z.string(),
    scopes: z.array(z.string()),
    trustLevel: z.string(),
    createdAt: z.string(),
    revokedAt: z.string().nullable(),
});

export const programRouterContract = {
    listUsers: contract("GET", "/users")
        .route({ description: "Lists all users with pagination." })
        .input(
            z.object({
                cursor: LapseId.optional()
                    .describe("Cursor for pagination. Omit to start from the beginning."),
                limit: z.number().int().min(1).max(100).default(50)
                    .describe("Maximum number of results to return."),
            })
        )
        .output(
            apiResult({
                users: z.array(ProgramUserSchema),
                nextCursor: z.string().nullable(),
            })
        ),

    getUser: contract("GET", "/users/get")
        .route({ description: "Gets a user by ID." })
        .input(
            z.object({
                id: LapseId
                    .describe("The user ID to look up."),
            })
        )
        .output(
            apiResult({
                user: ProgramUserSchema.nullable(),
            })
        ),

    listTimelapses: contract("GET", "/timelapses")
        .route({ description: "Lists all published timelapses with pagination." })
        .input(
            z.object({
                cursor: LapseId.optional()
                    .describe("Cursor for pagination."),
                limit: z.number().int().min(1).max(100).default(50)
                    .describe("Maximum number of results to return."),
            })
        )
        .output(
            apiResult({
                timelapses: z.array(ProgramTimelapseSchema),
                nextCursor: z.string().nullable(),
            })
        ),

    getTimelapse: contract("GET", "/timelapses/get")
        .route({ description: "Gets a timelapse by ID." })
        .input(
            z.object({
                id: LapseId
                    .describe("The timelapse ID to look up."),
            })
        )
        .output(
            apiResult({
                timelapse: ProgramTimelapseSchema.nullable(),
            })
        ),

    listComments: contract("GET", "/comments")
        .route({ description: "Lists all comments with pagination." })
        .input(
            z.object({
                cursor: LapseId.optional()
                    .describe("Cursor for pagination."),
                limit: z.number().int().min(1).max(100).default(50)
                    .describe("Maximum number of results to return."),
            })
        )
        .output(
            apiResult({
                comments: z.array(ProgramCommentSchema),
                nextCursor: z.string().nullable(),
            })
        ),

    stats: contract("GET", "/stats")
        .route({ description: "Gets platform-wide aggregate statistics." })
        .input(NO_INPUT)
        .output(
            apiResult({
                totalUsers: z.number(),
                totalTimelapses: z.number(),
                totalComments: z.number(),
                totalLoggedSeconds: z.number(),
            })
        ),

    listClients: contract("GET", "/clients")
        .route({ description: "Lists all OAuth service clients." })
        .input(NO_INPUT)
        .output(
            apiResult({
                clients: z.array(ProgramServiceClientSchema),
            })
        ),
};
