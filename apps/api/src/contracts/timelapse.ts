import { z } from "zod";
import { match } from "@hackclub/lapse-shared";

import { apiResult, LapseDate, LapseId } from "@/common";
import { MAX_VIDEO_FRAME_COUNT } from "@/constants";
import { contract, NO_OUTPUT } from "@/internal";
import { KnownDeviceSchema, PublicUserSchema } from "@/contracts/user";
import { CommentSchema } from "@/contracts/comment";

/**
 * Represents the possible visibility settings for a published timelapse.
 */
export type TimelapseVisibility = z.infer<typeof TimelapseVisibilitySchema>;
export const TimelapseVisibilitySchema = z.enum(["UNLISTED", "PUBLIC"]);

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
 * Represents a full view of a timelapse, including private fields.
 */
export type OwnedTimelapse = z.infer<typeof OwnedTimelapseSchema>;
export const OwnedTimelapseSchema = z.object({
    /**
     * The ID of timelapse.
     */
    id: LapseId,

    /**
     * The date when the timelapse was created.
     */
    createdAt: LapseDate,

    /**
     * Information about the owner/author of the timelapse.
     */
    owner: PublicUserSchema,

    /**
     * The name of the timelapse, as set by the user.
     */
    name: TimelapseName,

    /**
     * The description of the timelapse, as set by the user.
     */
    description: TimelapseDescription,

    /**
     * All comments for this timelapse.
     */
    // TODO: If we get to the point where timelapses can actually get viral and have a lot of comments, we'll have to paginate this.
    comments: z.array(CommentSchema),

    /**
     * Determines the discoverability of the timelapse.
     */
    visibility: TimelapseVisibilitySchema,

    /**
     * Must be `true` for public timelapses.
     */
    isPublished: z.boolean(),

    /**
     * The public URL that can be used to stream video data. If `isPublished` is `false`, the
     * video data will be encrypted with a device's passkey.
     */
    playbackUrl: z.url(),

    /**
     * The URL of the thumbnail image for this timelapse. Will be null if no thumbnail has been generated yet.
     */
    thumbnailUrl: z.url().nullable(),

    /**
     * The format of the video container.
     */
    videoContainerKind: TimelapseVideoContainerSchema,

    /**
     * The duration of the timelapse, in seconds. Must be non-negative.
     */
    duration: z.number().min(0),
    
    /**
     * Data accessible only to the author or administrators.
     */
    private: z.object({
        /**
         * The device the timelapse has been created on. This determines which passkey it has been
         * encrypted with.
         */
        device: KnownDeviceSchema.nullable(),

        /**
         * The Hackatime project that has been associated with the timelapse. If `null`, the timelapse
         * hasn't yet been synchronized with Hackatime.
         */
        hackatimeProject: z.string().nullable()
    })
});

/**
 * Represents a timelapse that may or may not be owned by the calling user.
 */
export type Timelapse = z.infer<typeof TimelapseSchema>;
export const TimelapseSchema = OwnedTimelapseSchema.partial({ private: true });

export const timelapseRouterContract = {
    query: contract("GET", "/timelapse/query")
        .route({
            summary: `
                Finds a timelapse by its ID. If the timelapse is not yet published, and the user does
                not own the timelapse, the endpoint will report that the timelapse does not exist.
                This endpoint will return a different view if the user owns the timelapse.
            `
        })
        .input(
            z.object({
                id: LapseId
                    .describe("The ID of the timelapse to query information about."),
            })
        )
        .output(
            apiResult({
                timelapse: TimelapseSchema,
            })
        ),

    createDraft: contract("POST", "/timelapse/createDraft")
        .route({
            summary: `
                Creates a draft timelapse. Draft timelapses can be commited and turned into regular timelapses by calling "timelapse.commit".
                Before a draft timelapse is commited, all AES-256-CBC encrypted data must be uploaded to the server using both the "videoToken"
                and the "thumbnailToken" via "/api/upload". The key or IV that the data is encrypted should be derived from the device passkey
                and timelapse ID. Other key/IV values will make the server unable to decrypt the timelapse.
            `
        })
        .input(z.object({
            containerType: TimelapseVideoContainerSchema
                .describe("The container format of the video stream. This will be used to derive the MIME type of the video.")
        }))
        .output(
            apiResult({
                id: LapseId
                    .describe("The ID that identifies the draft timelapse. When created, the resulting timelapse will be identified by this value."),
                
                videoToken: z.uuid()
                    .describe("Authorizes the client to upload the encrypted video via `/api/upload`."),
                
                thumbnailToken: z.uuid()
                    .describe("Authorizes the client to upload the encrypted thumbnail via `/api/upload`.")
            })
        ),

    commit: contract("POST", "/timelapse/commit")
        .route({ summary: "Commits a draft timelapse." })
        .input(
            z.object({
                id: LapseId,
                name: TimelapseName,
                description: TimelapseDescription,
                visibility: TimelapseVisibilitySchema,

                snapshots: z.array(z.int().min(0)).max(MAX_VIDEO_FRAME_COUNT)
                    .describe("An array of timestamps. Each timestamp counts the number of milliseconds since the Unix epoch - equivalent to `Date.getTime()` in JavaScript. The frame count is inferred by sorting the array, and always begins at 0."),
                
                deviceId: z.uuid()
                    .describe("The device that the timelapse has been created on. This generally is used to let other devices know what key to use to decrypt this timelapse.")
            })
        )
        .output(
            apiResult({
                timelapse: OwnedTimelapseSchema,
            })
        ),

    update: contract("PATCH", "/timelapse/update")
        .route({ summary: "Updates the metadata of a timelapse." })
        .input(
            z.object({
                id: LapseId
                    .describe("The ID of the timelapse to update."),
                    
                changes: z.object({
                    name: TimelapseName.optional(),
                    description: TimelapseDescription.optional(),
                    visibility: TimelapseVisibilitySchema.optional()
                })
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
        .route({ summary: "Permanently deletes a timelapse owned by the user." })
        .input(
            z.object({
                id: LapseId
            })
        )
        .output(NO_OUTPUT),

    publish: contract("POST", "/timelapse/publish")
        .route({ summary: "Publishes a timelapse, making it immutable and accessible by administrators. This will decrypt all of the segments contained within the timelapse. If not unlisted, will also make the timelapse public." })
        .input(
            z.object({
                id: LapseId
                    .describe("The ID of the timelapse to publish."),

                passkey: z.string().length(6)
                    .describe("The device passkey used to decrypt the timelapse."),

                visibility: TimelapseVisibilitySchema
                    .describe("The visibility setting for the published timelapse.")
            })
        )
        .output(
            apiResult({
                timelapse: OwnedTimelapseSchema
                    .describe("The new state of the timelapse, after publishing."),
            })
        ),

    findByUser: contract("GET", "/timelapse/findByUser")
        .route({ summary: "Finds all timelapses created by a given user." })
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
        .route({ summary: "Synchronizes a timelapse with a Hackatime project, converting all snapshots into heartbeats. This procedure can only be called once for a timelapse." })
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
        )
};
