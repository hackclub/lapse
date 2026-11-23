import { z } from "zod";
import { match } from "@hackclub/lapse-shared";
import { oc } from "@orpc/contract";

import { apiResult, LapseDate, LapseId } from "@/common";
import { contract, NO_OUTPUT } from "@/internal";
import { ROUTER_TAGS } from "@/tags";
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

/**
 * The minimum length for a timelapse name.
 */
export const MIN_TIMELAPSE_NAME_LENGTH = 2;

/**
 * The maximum length for a timelapse name.
 */
export const MAX_TIMELAPSE_NAME_LENGTH = 60;

/**
 * The maximum length for a timelapse description.
 */
export const MAX_TIMELAPSE_DESCRIPTION_LENGTH = 280;

export const TimelapseName = z.string().min(MIN_TIMELAPSE_NAME_LENGTH).max(MAX_TIMELAPSE_NAME_LENGTH);
export const TimelapseDescription = z.string().max(MAX_TIMELAPSE_DESCRIPTION_LENGTH).default("");

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

    blocker: z.string().nullable()
        .describe("If not `null`, the video has been withheld by Lapse staff, and this text should be shown in place of it. Clients may still let the user view the video anyway."),

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

/**
 * How the user chose to record from Lapse's recording mode picker.
 */
export type RecordingMode = z.infer<typeof RecordingModeSchema>;
export const RecordingModeSchema = z.enum(["desktop", "screen", "camera"]);

/**
 * How the Browser option in the recording mode picker is labelled, as part of an A/B test: no label, or "Less stable"
 * / "Legacy" shown either as a badge on the tile or as small text under its description.
 */
export type BrowserLabelVariant = z.infer<typeof BrowserLabelVariantSchema>;
export const BrowserLabelVariantSchema = z.enum(["none", "badge-less-stable", "badge-legacy", "text-less-stable", "text-legacy"]);

/**
 * Whether starting a Browser recording first asks the user to confirm, recommending the desktop app instead, as part
 * of an A/B test.
 */
export type BrowserWarningVariant = z.infer<typeof BrowserWarningVariantSchema>;
export const BrowserWarningVariantSchema = z.enum(["none", "warning"]);

export const timelapseRouterContract = oc.tag(ROUTER_TAGS.timelapse).router({
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

    approveDesktopPairing: contract("POST", "/timelapse/approveDesktopPairing")
        .route({ description: "Approves a Lookout desktop install to start recordings as the authenticated user, returning a one-time code for it to redeem. Requires an `elevated` grant, so only the Lapse website can call it." })
        .input(z.object({
            challenge: z.string().min(1).max(512)
                .describe("The PKCE challenge the desktop app generated. It proves it holds the matching verifier when redeeming the code, so an intercepted code is useless on its own."),
            label: z.string().min(1).max(120)
                .describe("Human-readable name for the device, shown to the user when they manage or revoke it."),
        }))
        .output(
            apiResult({
                code: z.string()
                    .describe("Single-use pairing code, valid for five minutes. Hand it back to the desktop app via its `lookout://pair` callback."),
            })
        ),

    listDesktopDevices: contract("GET", "/timelapse/listDesktopDevices")
        .route({ description: "Lists the Lookout desktop installs paired to the authenticated user." })
        .input(z.object({}))
        .output(
            apiResult({
                devices: z.array(z.object({
                    id: LapseId,
                    label: z.string(),
                    createdAt: z.string(),
                    lastUsedAt: z.string().nullable(),
                })),
            })
        ),

    revokeDesktopDevice: contract("POST", "/timelapse/revokeDesktopDevice")
        .route({ description: "Revokes a paired Lookout desktop install. It will have to be approved again before it can start recordings." })
        .input(z.object({
            id: LapseId.describe("The device to revoke."),
        }))
        .output(apiResult({ revoked: z.boolean() })),

    assignBrowserLabelVariant: contract("POST", "/timelapse/assignBrowserLabelVariant")
        .route({ description: "Puts the user in a variant of the Browser recording mode label A/B test, or returns the one they already have. `null` when the user isn't part of the test." })
        .input(z.object({}))
        .output(apiResult({ variant: BrowserLabelVariantSchema.nullable() })),

    assignBrowserWarningVariant: contract("POST", "/timelapse/assignBrowserWarningVariant")
        .route({ description: "Puts the user in a variant of the Browser recording warning A/B test, or returns the one they already have. `null` when the user isn't part of the test." })
        .input(z.object({}))
        .output(apiResult({ variant: BrowserWarningVariantSchema.nullable() })),

    getRecordingAvailability: contract("GET", "/timelapse/getRecordingAvailability")
        .route({ description: "Returns which recording modes the user can start right now. The Browser (screen) mode can be unavailable, e.g. during maintenance." })
        .input(z.object({}))
        .output(apiResult({
            browser: z.boolean()
                .describe("Whether the Browser (screen) recording mode is available. When `false`, `createRecordingSession` refuses it with `UNAVAILABLE`."),
        })),

    createRecordingSession: contract("POST", "/timelapse/createRecordingSession")
        .route({ description: "Creates a new Lookout-backed recording session and a server-side draft. Returns a Lookout token the client uses to initialize the Lookout SDK." })
        .input(z.object({
            mode: RecordingModeSchema.optional()
                .describe("The recording mode the user picked. Used to measure which modes people choose, and to refuse Browser mode while it is unavailable."),
        }))
        .output(
            apiResult({
                draftId: LapseId
                    .describe("The ID of the server-side draft."),
                lookoutToken: z.string()
                    .describe("The Lookout session token to pass to the Lookout SDK."),
                lookoutApiBaseUrl: z.string()
                    .describe("The base URL of the Lookout API."),
                lookoutSessionId: z.string()
                    .describe("The Lookout session ID, used to poll status."),
            })
        ),

    getLookoutDrafts: contract("GET", "/timelapse/getLookoutDrafts")
        .route({ description: "Lists all Lookout draft timelapses for the authenticated user, including their current Lookout session status." })
        .input(z.object({}))
        .output(
            apiResult({
                drafts: z.array(z.object({
                    id: LapseId,
                    createdAt: LapseDate,
                    lookoutSessionId: z.string(),
                    lookoutToken: z.string()
                        .describe("The Lookout session token to resume the recording with. Empty unless the caller may write to the user's timelapses (the `timelapse:write` scope)."),
                    lookoutStatus: z.string(),
                    videoUrl: z.string().nullable(),
                    thumbnailUrl: z.string().nullable(),
                    trackedSeconds: z.number().nonnegative().describe("Recorded time that counts towards the timelapse, in seconds."),
                    recordedOnDesktop: z.boolean().describe("Whether the session was recorded with the Lookout desktop app rather than in the browser."),
                })),
                lookoutApiBaseUrl: z.string(),
            })
        ),

    discardLookoutDraft: contract("DELETE", "/timelapse/discardLookoutDraft")
        .route({ description: "Archives a Lookout draft timelapse. It no longer shows up as a draft, but can be brought back with `restoreLookoutDraft`." })
        .input(
            z.object({
                id: LapseId,
            })
        )
        .output(NO_OUTPUT),

    getArchivedLookoutDrafts: contract("GET", "/timelapse/getArchivedLookoutDrafts")
        .route({ description: "Lists the authenticated user's archived Lookout drafts - discarded ones, and ones whose Lookout session couldn't be found - newest archive first." })
        .input(z.object({}))
        .output(
            apiResult({
                drafts: z.array(z.object({
                    id: LapseId,
                    createdAt: LapseDate,
                    archivedAt: LapseDate,
                    archivedReason: z.enum(["discarded", "session-gone"])
                        .describe("`discarded` if the user threw it away, `session-gone` if Lapse couldn't find its Lookout session."),
                    lookoutSessionId: z.string(),
                    lookoutStatus: z.string().nullable()
                        .describe("The Lookout session's status, or `null` if Lookout couldn't be reached or no longer has it."),
                    thumbnailUrl: z.string().nullable(),
                    trackedSeconds: z.number().nullable(),
                })),
            })
        ),

    restoreLookoutDraft: contract("POST", "/timelapse/restoreLookoutDraft")
        .route({ description: "Brings an archived Lookout draft back, so it can be continued or published again." })
        .input(
            z.object({
                id: LapseId,
            })
        )
        .output(
            apiResult({
                draftId: LapseId,
                lookoutStatus: z.string(),
            })
        ),

    publishFromLookout: contract("POST", "/timelapse/publishFromLookout")
        .route({ description: "Publishes a Lookout-backed timelapse from a draft. The Lookout session must have status 'complete'. Creates the timelapse record and deletes the draft." })
        .input(
            z.object({
                draftId: LapseId
                    .describe("The ID of the Lookout draft to publish."),
                name: TimelapseName,
                description: TimelapseDescription.optional(),
                visibility: TimelapseVisibilitySchema,
                hackatimeProject: z.string().min(1).max(128).optional()
                    .describe("If provided, snapshots will be synced to this Hackatime project."),
            })
        )
        .output(
            apiResult({
                timelapse: TimelapseSchema
            })
        ),

    pollLookoutStatus: contract("GET", "/timelapse/pollLookoutStatus")
        .route({ description: "Polls the status of a Lookout-backed recording/compilation by draft ID." })
        .input(
            z.object({
                draftId: LapseId
                    .describe("The draft ID to poll."),
            })
        )
        .output(
            apiResult({
                lookoutStatus: z.string()
                    .describe("The current Lookout session status (e.g. 'active', 'stopped', 'compiling', 'complete', 'failed')."),
                videoUrl: z.string().nullable()
                    .describe("The video URL, if compilation is complete."),
                thumbnailUrl: z.string().nullable()
                    .describe("The thumbnail URL, if compilation is complete."),

                recordedOnDesktop: z.boolean()
                    .describe("Whether the session was recorded through the Lookout desktop app. Editing such a session belongs to the desktop app's own editor, so Lapse leaves it alone."),

                publishedTimelapseId: LapseId.nullable()
                    .describe(`
                        Set when this draft has just been published on our side, which happens without the user when
                        they filled in the details in the desktop app's publish panel before the video had finished
                        compiling. Clients seeing this should go straight to the timelapse instead of asking again.
                    `),
            })
        ),

    listChanged: contract("GET", "/timelapse/listChanged")
        .route({ description: "Lists every timelapse that was published, changed or deleted after a cursor, oldest change first, for services that keep their own copy of the catalog. Covers every visibility, including timelapses that failed or are still processing. Changes less than 30 seconds old aren't listed yet, so that one written late, or on a server whose clock runs behind, can't be skipped. A timelapse can come up more than once, and its `timelapse` is how it is now rather than at `changedAt`." })
        .input(
            z.object({
                cursor: z.string().min(1).max(1024).optional()
                    .describe("The `nextCursor` of the previous page. Omit to start from the very first timelapse."),

                limit: z.coerce.number().int().min(1).max(500).default(200)
                    .describe("The maximum number of changes to return."),
            })
        )
        .output(
            apiResult({
                changes: z.array(z.discriminatedUnion("kind", [
                    z.object({
                        kind: z.literal("upsert"),
                        changedAt: LapseDate
                            .describe("When the timelapse was published or last changed."),
                        timelapse: OwnedTimelapseSchema
                    }),
                    z.object({
                        kind: z.literal("delete"),
                        changedAt: LapseDate
                            .describe("When the timelapse was deleted."),
                        id: LapseId
                            .describe("The ID the deleted timelapse had."),
                        ownerId: LapseId
                            .describe("The ID of the user who owned it. That user may have been deleted too."),
                    })
                ]))
                    .describe("The changes, ordered by `changedAt`, then deletions before upserts, then ID."),

                nextCursor: z.string()
                    .describe("Where the next page starts. The same as the cursor given when there were no changes - keep it and ask again later."),

                hasMore: z.boolean()
                    .describe("Whether more changes are ready right now. `false` means the caller has caught up."),
            })
        ),

    myPublishedTimelapses: contract("GET", "/timelapse/myPublishedTimelapses")
        .route({ description: "Lists all published timelapses owned by the authenticated user, with cursor-based pagination." })
        .input(
            z.object({
                cursor: LapseId.optional()
                    .describe("The ID of the last timelapse from the previous page. Omit to start from the beginning."),

                limit: z.coerce.number().int().min(1).max(100).default(20)
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
});
