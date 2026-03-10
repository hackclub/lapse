import { z } from "zod";

import { apiResult, LapseDate, LapseId } from "@/common";
import { MAX_VIDEO_FRAME_COUNT } from "@/constants";
import { contract, NO_INPUT, NO_OUTPUT } from "@/internal";
import { TimelapseDescription, TimelapseName } from "@/contracts/timelapse";
import { PublicUserSchema } from "@/contracts/user";

/**
 * Represents an action to perform across a select timespan of a timelapse. Edit list entries are applied right
 * after decryption, during re-encoding.
 */
export type EditListEntry = z.infer<typeof EditListEntrySchema>;
export const EditListEntrySchema = z.object({
    begin: z.number().nonnegative()
        .describe("The start time (in seconds) of the region this entry describes."),

    end: z.number().nonnegative()
        .describe("The end time (in seconds) of the region this entry describes. This field has to be greater than `begin`."),

    kind: z.enum(["CUT"])
        .describe("The kind of edit to apply.")
});

/**
 * Represents a subset of `DraftTimelapse` that is freely editable by its owner.
 */
export type DraftTimelapsePayload = z.infer<typeof DraftTimelapsePayloadSchema>;
export const DraftTimelapsePayloadSchema = z.object({
    name: TimelapseName.optional()
        .describe("The current name of the draft timelapse."),

    description: TimelapseDescription
        .describe("The current description of the draft timelapse."),

    editList: z.array(EditListEntrySchema)
        .describe("The edits to apply to the resulting footage.")
});

/**
 * Represents a timelapse that has not yet been published, and can be freely modified by the user. This serves as a way to synchronize
 * timelapse data between the owners' devices.
 */
export type DraftTimelapse = z.infer<typeof DraftTimelapseSchema>;
export const DraftTimelapseSchema = DraftTimelapsePayloadSchema.extend({
    id: LapseId
        .describe("The ID of the draft timelapse. This will *not* be the same as the ID of the resulting published timelapse."),
        
    sessions: z.array(z.url())
        .describe("URIs pointing to separate, sequential video files that compose the timelapse."),

    createdAt: LapseDate
        .describe("The timestamp when the draft timelapse was created."),

    previewThumbnail: z.url()
        .describe("An URL to an encrypted user-generated preview thumbnail that represents the timelapse."),

    deviceId: z.uuid()
        .describe("The UUID of the known device that has encrypted this draft."),
        
    owner: PublicUserSchema
        .describe("The user that has created this draft timelapse."),

    isDraft: z.literal(true)
        .describe("Always `true`. This field is provided for convenience when using strongly-typed clients."),

    iv: z.hex()
        .describe("The IV to use when encrypting and decrypting binary data associated with the timelapse."),

    associatedTimelapseId: LapseId.optional()
        .describe("If defined, this draft is currently being published and has an associated timelapse that is processing.")
});

/**
 * Represents an unpublished, encrypted timelapse that has been created with a legacy version of Lapse.
 */
export type LegacyUnpublishedTimelapse = z.infer<typeof LegacyUnpublishedTimelapseSchema>;
export const LegacyUnpublishedTimelapseSchema = z.object({
    id: LapseId
        .describe("The original ID of the unpublished timelapse."),

    name: z.string()
        .describe("The original name (title) of the timelapse."),

    description: z.string()
        .describe("The original description of the timelapse."),

    primarySession: z.string()
        .describe("A URL pointing to the encrypted primary session of the timelapse. Legacy versions of Lapse only supported single-session timelapses."),

    thumbnailUrl: z.string()
        .describe("A URL pointing to the encrypted thumbnail URL of the timelapse."),

    deviceId: z.uuid()
        .describe("The ID of the device that has created this timelapse."),

    snapshots: LapseDate.array()
        .describe("Timestamps taken at regular intervals while the timelapse was recorded. This directly represents the resulting Hackatime heartbeats.")
});

export const draftTimelapseRouterContract = {
    findByUser: contract("GET", "/draftTimelapse/findByUser")
        .route({ description: "Gets all draft timelapses created by the given user." })
        .input(z.object({
            user: LapseId
                .describe("The ID of the user to fetch the draft timelapses for. For regular users, this must be the ID of the authenticated user.")
        }))
        .output(
            apiResult({
                timelapses: z.array(DraftTimelapseSchema)
            })
        ),

    query: contract("GET", "/draftTimelapse/query")
        .route({ description: "Finds a draft timelapse by its ID. If the caller is not the owner of the draft or an admin, this endpoint will report that the timelapse doesn't exist." })
        .input(z.object({
            id: LapseId
                .describe("The ID of the draft timelapse.")
        }))
        .output(
            apiResult({
                timelapse: DraftTimelapseSchema
            })
        ),

    create: contract("POST", "/draftTimelapse/create")
        .route({ description: `Creates a draft timelapse. Draft timelapses can be published and turned into regular timelapses by calling "timelapse.publish".` })
        .input(z.object({
            name: TimelapseName.optional()
                .describe("The name to assign to the created timelapse draft."),

            description: TimelapseDescription.optional()
                .describe("The description to assign to the created timelapse draft."),

            snapshots: z.array(z.int().min(0)).max(MAX_VIDEO_FRAME_COUNT)
                .describe("An array of timestamps. Each timestamp counts the number of milliseconds since the Unix epoch - equivalent to `Date.getTime()` in JavaScript. The frame count is inferred by sorting the array, and always begins at 0."),
                
            deviceId: z.uuid()
                .describe("The device that the timelapse has been created on. This is used to let other devices know which key to use to decrypt this timelapse."),
                
            sessions: z.array(
                z.object({
                    fileSize: z.number()
                        .describe(`
                            The size, in bytes, of this session. The session is expected to be *exactly* this
                            large - the PUT upload URL for this session will enforce the \`Content-Length\`
                            HTTP header to be equal to this value.
                        `)
                })
            ).describe(`
                The sessions that make up this draft. A session is a separately recorded video stream - all sessions are concatenated
                together into one master video during server re-encoding.
            `),

            thumbnailSize: z.number()
                .describe("The size, in bytes, of the user-generated preview thumbnail for this draft. As is the case for sessions, the size of the thumbnail is expected to match this value exactly.")
        }))
        .output(
            apiResult({
                draftTimelapse: DraftTimelapseSchema
                    .describe("The newly created draft timelapse."),

                sessionUploadTokens: z.array(z.jwt())
                    .describe("An array containing the upload JWT tokens to pass over as the tus metadata when uploading the sessions."),

                thumbnailUploadToken: z.jwt()
                    .describe("The `tus` upload JWT token identifying the encrypted preview thumbnail. This thumbnail will *not* be used when publishing, and will be encrypted with the device's passkey.")
            })
        ),

    update: contract("PATCH", "/draftTimelapse/update")
        .route({ description: "Updates a draft timelapse." })
        .input(
            z.object({
                id: LapseId
                    .describe("The ID of the draft timelapse to update."),
                    
                changes: DraftTimelapsePayloadSchema
                    .describe("The changes to apply to the draft timelapse.")
            })
        )
        .output(
            apiResult({
                timelapse: DraftTimelapseSchema
                    .describe("The new state of the draft timelapse, after applying the updates."),
            })
        ),

    delete: contract("DELETE", "/draftTimelapse/delete")
        .route({ description: "Permanently deletes a draft timelapse owned by the user." })
        .input(
            z.object({
                id: LapseId
            })
        )
        .output(NO_OUTPUT),

    legacy: contract("GET", "/draftTimelapse/legacy")
        .route({ description: "Queries all unpublished timelapses that were created by the caller with a legacy version of Lapse that have not yet been migrated." })
        .input(NO_INPUT)
        .output(
            apiResult({
                timelapses: LegacyUnpublishedTimelapseSchema.array()
                    .describe("The legacy timelapses created by the user that have not yet been migrated.")
            })
        ),

    markAsMigrated: contract("POST", "/draftTimelapse/markAsMigrated")
        .route({ description: "Marks a legacy unpublished timelapse as migrated. This does not delete the record - it only prevents it from appearing in the legacy query." })
        .input(z.object({
            id: LapseId
                .describe("The ID of the legacy unpublished timelapse to mark as migrated.")
        }))
        .output(NO_OUTPUT)
};
