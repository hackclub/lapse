import { z } from "zod";
import { match } from "@hackclub/lapse-shared";

import { apiResult, LapseDate, LapseId } from "@/common";
import { contract, NO_OUTPUT } from "@/internal";
import { PublicUserSchema } from "@/contracts/user";
import { CommentSchema } from "@/contracts/comment";

/**
 * Represents the possible visibility settings for a published timelapse.
 */
export type TimelapseVisibility = z.infer<typeof TimelapseVisibilitySchema>;
export const TimelapseVisibilitySchema = z.enum(["UNLISTED", "PUBLIC", "FAILED_PROCESSING"]);

/**
 * Represents supported container formats for timelapse video streams.
 */
export type TimelapseVideoContainer = z.infer<typeof TimelapseVideoContainerSchema>;
export const TimelapseVideoContainerSchema = z.enum(["WEBM", "MP4"]);

export function containerTypeToMimeType(container: TimelapseVideoContainer) {
    return match(container, {
        "MP4": "video/mp4" as const,
        "WEBM": "video/webm" as const
    });
}

export function mimeTypeToContainerType(type: string) {
    return match(type, {
        "video/mp4": "MP4" as const,
        "video/webm": "WEBM" as const
    });
}

export function containerTypeToExtension(container: TimelapseVideoContainer) {
    return match(container, {
        "MP4": "mp4" as const,
        "WEBM": "webm" as const
    });
}

export const TimelapseName = z.string().min(2).max(60);
export const TimelapseDescription = z.string().max(280).default("");

/**
 * Represents the user-modifiable fields of a `Timelapse`.
 */
export type TimelapsePayload = z.infer<typeof TimelapsePayloadSchema>;
export const TimelapsePayloadSchema = z.object({
    /**
     * The name of the timelapse, as set by the user.
     */
    name: TimelapseName,

    /**
     * The description of the timelapse, as set by the user.
     */
    description: TimelapseDescription,

    /**
     * Determines the discoverability of the timelapse.
     */
    visibility: TimelapseVisibilitySchema
});

/**
 * Represents a full view of a timelapse, including private fields.
 */
export type OwnedTimelapse = z.infer<typeof OwnedTimelapseSchema>;
export const OwnedTimelapseSchema = TimelapsePayloadSchema.extend({
    id: LapseId
        .describe("The ID of the timelapse."),

    createdAt: LapseDate
        .describe("The date when the timelapse was created."),

    owner: PublicUserSchema
        .describe("Information about the owner/author of the timelapse."),

    comments: z.array(CommentSchema)
        .describe("All comments for this timelapse."),

    playbackUrl: z.url().nullable()
        .describe("The public URL that can be used to stream video data. If `null`, the timelapse is still being processed."),

    thumbnailUrl: z.url().nullable()
        .describe("The URL of the thumbnail image for this timelapse. If `null`, the timelapse is still being processed. It's recommended to derive the processing status of the timelapse from `playbackUrl`."),

    duration: z.number().min(0)
        .describe("The duration of the timelapse, in seconds. Must be non-negative."),
    
    isDraft: z.literal(false)
        .describe("Always `false`. This field is provided for convenience when using strongly-typed clients."),

    /**
     * Data accessible only to the author or administrators.
     */
    private: z.object({
        /**
         * The Hackatime project that has been associated with the timelapse. If `null`, the timelapse
         * hasn't yet been synchronized with Hackatime.
         */
        hackatimeProject: z.string().nullable(),

        /**
         * The ID of the draft timelapse that this timelapse was originally published from.
         * If `null`, the source draft is unknown.
         */
        sourceDraftId: z.string().nullable()
    })
});

/**
 * Represents a timelapse that may or may not be owned by the calling user.
 */
export type Timelapse = z.infer<typeof TimelapseSchema>;
export const TimelapseSchema = OwnedTimelapseSchema.partial({ private: true }).extend({
    isDraft: z.literal(false)
        .describe("Always `false`. This field is provided for convenience when using strongly-typed clients.")
});

export const timelapseRouterContract = {
    query: contract("GET", "/timelapse/query")
        .route({ description: "Finds a timelapse by its ID. This endpoint will return a different view if the user owns the timelapse." })
        .input(
            z.object({
                id: LapseId
                    .describe("The ID of the timelapse to query information about."),
            })
        )
        .output(
            apiResult({
                timelapse: TimelapseSchema
            })
        ),

    publish: contract("POST", "/timelapse/publish")
        .route({ description: "Publishes a draft timelapse. This will delete the draft timelapse." })
        .input(
            z.object({
                id: LapseId
                    .describe("The ID of the draft timelapse to publish."),

                visibility: TimelapseVisibilitySchema
                    .describe("The visibility the published timelapse should have. This can be changed later."),

                deviceKey: z.string().regex(/^[0-9a-f]{32}$/)
                    .describe("The 128-bit device key (lowercase hex) used to decrypt the video sessions in the draft timelapse."),

                hackatimeProject: z.string().min(1).max(128).optional()
                    .describe("If provided, the timelapse snapshots will be synced to this Hackatime project after processing completes."),
            })
        )
        .output(
            apiResult({
                timelapse: TimelapseSchema
            })
        ),

    update: contract("PATCH", "/timelapse/update")
        .route({ description: "Updates the metadata of a timelapse." })
        .input(
            z.object({
                id: LapseId
                    .describe("The ID of the timelapse to update."),
                    
                changes: TimelapsePayloadSchema.partial()
                    .describe("The changes to apply to the timelapse.")
            })
        )
        .output(
            apiResult({
                timelapse: OwnedTimelapseSchema
                    .describe("The new state of the timelapse, after applying the updates."),
            })
        ),

    delete: contract("DELETE", "/timelapse/delete")
        .route({ description: "Permanently deletes a timelapse owned by the user." })
        .input(
            z.object({
                id: LapseId
            })
        )
        .output(NO_OUTPUT),

    findByUser: contract("GET", "/timelapse/findByUser")
        .route({ description: "Finds all timelapses created by a given user." })
        .input(
            z.object({
                user: LapseId,
            })
        )
        .output(
            apiResult({
                timelapses: z.array(TimelapseSchema)
                    .describe("All timelapses created by the user."),
            })
        ),

    syncWithHackatime: contract("POST", "/timelapse/syncWithHackatime")
        .route({ description: "Synchronizes a timelapse with a Hackatime project, converting all snapshots into heartbeats. This procedure can only be called once for a timelapse." })
        .input(
            z.object({
                id: LapseId,
                hackatimeProject: z.string().min(1).max(128)
            })
        )
        .output(
            apiResult({
                timelapse: TimelapseSchema
            })
        ),

    myPublishedTimelapses: contract("GET", "/timelapse/myPublishedTimelapses")
        .route({ description: "Lists all published timelapses owned by the authenticated user, with cursor-based pagination." })
        .input(
            z.object({
                cursor: LapseId.optional()
                    .describe("The ID of the last timelapse from the previous page. Omit to start from the beginning."),
                limit: z.number().int().min(1).max(100).default(20)
                    .describe("The maximum number of timelapses to return per page."),
            })
        )
        .output(
            apiResult({
                timelapses: z.array(OwnedTimelapseSchema)
                    .describe("The timelapses for this page."),
                nextCursor: z.string().nullable()
                    .describe("The cursor to use for the next page. `null` if there are no more results."),
            })
        )
};
