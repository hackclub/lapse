import "@/server/allow-only-server";

import { z } from "zod";
import { S3Client } from "@aws-sdk/client-s3";
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

import { apiResult, ascending, match, when, apiOk, apiErr, oneOf, closest, chunked, assert, Result, Err } from "@/shared/common";
import { MAX_VIDEO_FRAME_COUNT, MAX_VIDEO_UPLOAD_SIZE, MAX_THUMBNAIL_UPLOAD_SIZE, TIMELAPSE_FRAME_LENGTH_MS } from "@/shared/constants";
import { createUploadToken, consumeUploadTokens } from "@/server/services/uploadTokens";

import { router, protectedProcedure, publicProcedure } from "@/server/trpc";
import { decryptVideo } from "@/server/encryption";
import { env } from "@/server/env";
import { HackatimeOAuthApi, HackatimeUserApi, WakaTimeHeartbeat } from "@/server/hackatime";
import { logError, logInfo, logRequest } from "@/server/serverCommon";
import { generateThumbnail } from "@/server/videoProcessing";
import { Actor, actorEntitledTo, actorIsServer, actorIsUser, ApiDate, PublicId } from "@/server/routers/common";
import { dtoKnownDevice, dtoPublicUser, KnownDeviceSchema, PublicUserSchema } from "@/server/routers/api/user";
import { CommentSchema, DbComment, dtoComment } from "@/server/routers/api/comment";
import { database } from "@/server/db";

import * as db from "@/generated/prisma/client";
const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${env.S3_ENDPOINT}`,
    credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
});

export type DbTimelapse = db.Timelapse & { owner: db.User, comments: DbComment[] };
export type DbOwnedTimelapse = DbTimelapse & { owner: db.User, device: db.KnownDevice | null };

/**
 * Converts a database representation of a timelapse to a runtime (API) one. This excludes private fields.
 */
export function dtoPublicTimelapse(entity: DbTimelapse): Timelapse {
    // This lacks `isPublished` so that we have to mark it explicitly when creating a DTO
    // that might hold private data (e.g. device names).
    return {
        id: entity.id,
        createdAt: entity.createdAt.getTime(),
        owner: dtoPublicUser(entity.owner),
        name: entity.name,
        description: entity.description,
        comments: entity.comments.map(dtoComment),
        visibility: entity.visibility,
        playbackUrl: `${entity.isPublished ? env.S3_PUBLIC_URL_PUBLIC : env.S3_PUBLIC_URL_ENCRYPTED}/${entity.s3Key}`,
        thumbnailUrl: entity.thumbnailS3Key 
            ? `${entity.isPublished ? env.S3_PUBLIC_URL_PUBLIC : env.S3_PUBLIC_URL_ENCRYPTED}/${entity.thumbnailS3Key}`
            : null,
        videoContainerKind: entity.containerKind,
        isPublished: entity.isPublished,
        duration: entity.duration,
    };
}

/**
 * Converts a database representation of a timelapse to a runtime (API) one, including all private fields.
 */
export function dtoOwnedTimelapse(entity: DbOwnedTimelapse): OwnedTimelapse {
    return {
        ...dtoPublicTimelapse(entity),
        private: {
            device: entity.device ? dtoKnownDevice(entity.device) : null,
            hackatimeProject: entity.hackatimeProject
        }
    };
}

/**
 * Converts a database representation of a timelapse to a runtime (API) one, including all private fields if the
 * `actor` is entitled to said fields.
 */
export function dtoTimelapse(entity: DbTimelapse | DbOwnedTimelapse, actor: Actor): Timelapse | OwnedTimelapse {
    if (actorEntitledTo(entity, actor) && "device" in entity) {
        // This timelapse should be considered owned.
        return dtoOwnedTimelapse(entity);
    }

    // Either not enough data in our `entity` payload, or the actor does not own this timelapse.
    if (!entity.isPublished)
        throw new Error("Attempted to DTO a unpublished timelapse as an actor that does not own it!");

    return dtoPublicTimelapse(entity);
}

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

/**
 * Finds a timelapse by its ID.
 */
export async function getTimelapseById(id: string, actor: Actor): Promise<Result<Timelapse | OwnedTimelapse>> {
    const timelapse = await database.timelapse.findFirst({
        where: { id },
        include: TIMELAPSE_INCLUDES
    });

    if (!timelapse)
        return new Err("NOT_FOUND", "Couldn't find that timelapse!");

    if (!timelapse.isPublished && !actorEntitledTo(timelapse, actor))
        return new Err("NOT_FOUND", "Couldn't find that timelapse!");

    return dtoTimelapse(timelapse, actor);
}

/**
 * Permanently deletes a timelapse, including all its snapshots and S3 files.
 */
export async function deleteTimelapse(timelapseId: string, actor: Actor): Promise<Result<void>> {
    const timelapse = await database.timelapse.findFirst({
        where: { id: timelapseId }
    });

    if (!timelapse)
        return new Err("NOT_FOUND", "Couldn't find that timelapse!");

    if (actor !== "SERVER") {
        const canDelete =
            actor && (
                actor.id === timelapse.ownerId ||
                actor.permissionLevel in oneOf("ADMIN", "ROOT")
            );

        if (!canDelete) {
            return new Err("NO_PERMISSION", "You don't have permission to delete this timelapse");
        }
    }

    await database.snapshot.deleteMany({
        where: { timelapseId: timelapse.id }
    });

    const bucket = timelapse.isPublished ? env.S3_PUBLIC_BUCKET_NAME : env.S3_ENCRYPTED_BUCKET_NAME; 

    await s3.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: timelapse.s3Key
    }));

    if (timelapse.thumbnailS3Key) {
        await s3.send(new DeleteObjectCommand({
            Bucket: bucket,
            Key: timelapse.thumbnailS3Key
        }));
    }

    await database.timelapse.delete({
        where: { id: timelapse.id }
    });

    logInfo("timelapse", `Timelapse ${timelapseId} deleted.`);
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
    id: PublicId,

    /**
     * The date when the timelapse was created.
     */
    createdAt: ApiDate,

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
 * Specify this for `include` when querying `Timelapse` entities in order to retrieve the data required for a `DbOwnedTimelapse`.
 */
export const TIMELAPSE_INCLUDES = {
    owner: true,
    device: true,
    comments: {
        include: { author: true },
        orderBy: {
            createdAt: "desc"
        }
    }
} as const satisfies db.Prisma.TimelapseInclude;

/**
 * Represents a timelapse that may or may not be owned by the calling user.
 */
export type Timelapse = z.infer<typeof TimelapseSchema>;
export const TimelapseSchema = OwnedTimelapseSchema.partial({ private: true });

export default router({
    query: publicProcedure("GET", "/timelapse/query")
        .summary("Finds a timelapse by its ID. If the timelapse is not yet published, and the user does not own the timelapse, the endpoint will report that the timelapse does not exist. This endpoint will return a different view if the user owns the timelapse.")
        .input(
            z.object({
                id: PublicId
                    .describe("The ID of the timelapse to query information about."),
            })
        )
        .output(
            apiResult({
                timelapse: TimelapseSchema,
            })
        )
        .query(async (req) => {
            logRequest("timelapse/query", req);

            const timelapse = await getTimelapseById(req.input.id, req.ctx.user);
            if (timelapse instanceof Err)
                return timelapse.toApiError();

            return apiOk({ timelapse });
        }),

    createDraft: protectedProcedure(["timelapse:write"], "POST", "/timelapse/createDraft")
        .summary(`
            Creates a draft timelapse. Draft timelapses can be commited and turned into regular timelapses by calling "timelapse.commit".
            Before a draft timelapse is commited, all AES-256-CBC encrypted data must be uploaded to the server using both the "videoToken"
            and the "thumbnailToken" via "/api/upload". The key or IV that the data is encrypted should be derived from the device passkey
            and timelapse ID. Other key/IV values will make the server unable to decrypt the timelapse.
        `)
        .input(z.object({
            containerType: TimelapseVideoContainerSchema
                .describe("The container format of the video stream. This will be used to derive the MIME type of the video.")
        }))
        .output(
            apiResult({
                id: PublicId
                    .describe("The ID that identifies the draft timelapse. When created, the resulting timelapse will be identified by this value."),
                
                videoToken: z.uuid()
                    .describe("Authorizes the client to upload the encrypted video via `/api/upload`."),
                
                thumbnailToken: z.uuid()
                    .describe("Authorizes the client to upload the encrypted thumbnail via `/api/upload`.")
            })
        )
        .query(async (req) => {
            logRequest("timelapse/createDraft", req);
            const baseId = crypto.randomUUID();

            const video = await createUploadToken(database, {
                ownerId: req.ctx.user.id,
                bucket: env.S3_ENCRYPTED_BUCKET_NAME,
                key: `timelapses/${req.ctx.user.id}/${baseId}.${containerTypeToExtension(req.input.containerType)}`,
                mimeType: containerTypeToMimeType(req.input.containerType),
                maxSize: MAX_VIDEO_UPLOAD_SIZE,
            });

            const thumbnail = await createUploadToken(database, {
                ownerId: req.ctx.user.id,
                bucket: env.S3_ENCRYPTED_BUCKET_NAME,
                key: `timelapses/${req.ctx.user.id}/${baseId}-thumbnail.jpg`,
                mimeType: "image/jpeg",
                maxSize: MAX_THUMBNAIL_UPLOAD_SIZE,
            });

            const draft = await database.draftTimelapse.create({
                data: {
                    ownerId: req.ctx.user.id,
                    videoTokenId: video.id,
                    thumbnailTokenId: thumbnail.id,
                }
            });

            return apiOk({ id: draft.id, videoToken: video.id, thumbnailToken: thumbnail.id });
        }),

    commit: protectedProcedure(["timelapse:write"], "POST", "/timelapse/commit")
        .summary("Commits a draft timelapse.")
        .input(
            z.object({
                id: PublicId,
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
        )
        .mutation(async (req) => {
            logRequest("timelapse/commit", req);

            const draft = await database.draftTimelapse.findFirst({
                where: { id: req.input.id, ownerId: req.ctx.user.id },
                include: { videoToken: true, thumbnailToken: true }
            });

            if (!draft)
                return apiErr("NOT_FOUND", `The draft timelapse ${req.input.id} couldn't be found.`);

            const videoUpload = draft.videoToken;
            const thumbnailUpload = draft.thumbnailToken;

            assert(videoUpload.ownerId == req.ctx.user.id, "Video upload token wasn't owned by draft owner");
            assert(thumbnailUpload.ownerId == req.ctx.user.id, "Thumbnail upload token wasn't owned by draft owner");

            if (!videoUpload.uploaded)
                return apiErr("NO_FILE", "The video hasn't yet been uploaded.");

            if (!thumbnailUpload.uploaded)
                return apiErr("NO_FILE", "The thumbnail hasn't yet been uploaded.");

            const device = await database.knownDevice.findFirst({
                where: { id: req.input.deviceId }
            });

            if (!device)
                return apiErr("DEVICE_NOT_FOUND", "The device creating this snapshot hasn't been registered with the server.");

            if (device.ownerId != req.ctx.user.id)
                return apiErr("NO_PERMISSION", "The specified device doesn't belong to the logged in user.");

            const timelapse = await database.timelapse.create({
                include: TIMELAPSE_INCLUDES,
                data: {
                    id: draft.id,
                    createdAt: draft.createdAt,
                    ownerId: req.ctx.user.id,
                    name: req.input.name,
                    description: req.input.description,
                    visibility: req.input.visibility,
                    containerKind: mimeTypeToContainerType(videoUpload.mimeType),
                    isPublished: false,
                    s3Key: videoUpload.key,
                    thumbnailS3Key: thumbnailUpload.key,
                    deviceId: req.input.deviceId,
                    duration: (req.input.snapshots.length * TIMELAPSE_FRAME_LENGTH_MS) / 1000
                }
            });

            const sortedSnapshots = req.input.snapshots.sort(ascending());
            
            for (const batch of chunked(sortedSnapshots, 100)) {
                await database.snapshot.createMany({
                    skipDuplicates: true,
                    data: batch.map((x, i) => ({
                        timelapseId: timelapse.id,
                        frame: i,
                        createdAt: new Date(x)
                    }))
                });
            }

            await database.$transaction(async (tx) => {
                await tx.draftTimelapse.delete({ where: { id: draft.id } });
                await consumeUploadTokens(tx, [draft.videoTokenId, draft.thumbnailTokenId]);
            });

            return apiOk({ timelapse: dtoOwnedTimelapse(timelapse) });
        }),

    update: protectedProcedure(["timelapse:write"], "PATCH", "/timelapse/update")
        .summary("Updates the metadata of a timelapse.")
        .input(
            z.object({
                id: PublicId
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
        )
        .mutation(async (req) => {
            logRequest("timelapse/update", req);

            const timelapse = await database.timelapse.findFirst({
                where: { id: req.input.id },
            });

            if (!timelapse)
                return apiErr("NOT_FOUND", "Couldn't find that timelapse!");

            const canEdit =
                req.ctx.user.id === timelapse.ownerId ||
                req.ctx.user.permissionLevel in oneOf("ADMIN", "ROOT");

            if (!canEdit)
                return apiErr("NOT_FOUND", "You don't have permission to edit this timelapse");

            const updateData: Partial<db.Timelapse> = {};
            if (req.input.changes.name) {
                updateData.name = req.input.changes.name;
            }

            if (req.input.changes.description !== undefined) {
                updateData.description = req.input.changes.description;
            }

            if (req.input.changes.visibility) {
                updateData.visibility = req.input.changes.visibility;
            }

            const updatedTimelapse = await database.timelapse.update({
                where: { id: req.input.id },
                data: updateData,
                include: TIMELAPSE_INCLUDES
            });

            return apiOk({ timelapse: dtoOwnedTimelapse(updatedTimelapse) });
        }),

    delete: protectedProcedure(["timelapse:write"], "DELETE", "/timelapse/delete")
        .summary("Permanently deletes a timelapse owned by the user.")
        .input(
            z.object({
                id: PublicId,
            })
        )
        .output(apiResult({}))
        .mutation(async (req) => {
            logRequest("timelapse/delete", req);

            try {
                await deleteTimelapse(req.input.id, req.ctx.user);
                return apiOk({});
            }
            catch (error) {
                logError("timelapse.delete", "Failed to delete timelapse!", { error });
                return apiErr("ERROR", "Failed to delete timelapse");
            }
        }),

    publish: protectedProcedure(["timelapse:write"], "POST", "/timelapse/publish")
        .summary("Publishes a timelapse, making it immutable and accessible by administrators. This will decrypt all of the segments contained within the timelapse. If not unlisted, will also make the timelapse public.")
        .input(
            z.object({
                id: PublicId
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
        )
        .mutation(async (req) => {
            logRequest("timelapse/publish", req);
            
            const timelapse = await database.timelapse.findFirst({
                where: { id: req.input.id },
            });

            if (!timelapse)
                return apiErr("NOT_FOUND", "Couldn't find that timelapse!");

            const canPublish =
                req.ctx.user.id === timelapse.ownerId ||
                req.ctx.user.permissionLevel in oneOf("ADMIN", "ROOT");

            if (!canPublish)
                return apiErr("NO_PERMISSION", "You don't have permission to publish this timelapse");

            if (timelapse.isPublished)
                return apiErr("ALREADY_PUBLISHED", "Timelapse already published");

            try {
                const encryptedObject = await s3.send(new GetObjectCommand({
                    Bucket: env.S3_ENCRYPTED_BUCKET_NAME,
                    Key: timelapse.s3Key
                }));

                const encryptedBuffer = await encryptedObject.Body?.transformToByteArray();

                if (!encryptedBuffer)
                    return apiErr("NO_FILE", "Failed to retrieve encrypted video");

                let decryptedBuffer: Buffer;

                try {
                    decryptedBuffer = decryptVideo(
                        encryptedBuffer,
                        req.input.id,
                        req.input.passkey
                    );
                }
                catch {
                    return apiErr("ERROR", "Invalid passkey provided. Please check your 6-digit PIN.");
                }

                await s3.send(new PutObjectCommand({
                    Bucket: env.S3_PUBLIC_BUCKET_NAME,
                    Key: timelapse.s3Key,
                    Body: decryptedBuffer,
                    ContentType: containerTypeToMimeType(timelapse.containerKind)
                }));

                // Generate and upload thumbnail
                let thumbnailS3Key: string | null = null;
                try {
                    const thumbnailBuffer = await generateThumbnail(decryptedBuffer);
                    thumbnailS3Key = timelapse.s3Key.replace(/\.(webm|mp4)$/, "-thumbnail.jpg");
                    
                    await s3.send(new PutObjectCommand({
                        Bucket: env.S3_PUBLIC_BUCKET_NAME,
                        Key: thumbnailS3Key,
                        Body: thumbnailBuffer,
                        ContentType: "image/jpeg"
                    }));
                }
                catch (thumbnailError) {
                    console.warn("(timelapse.ts)", "Failed to generate thumbnail for published timelapse:", thumbnailError);
                    // Continue without thumbnail
                }

                await s3.send(new DeleteObjectCommand({
                    Bucket: env.S3_ENCRYPTED_BUCKET_NAME,
                    Key: timelapse.s3Key,
                }));

                const publishedTimelapse = await database.timelapse.update({
                    where: { id: req.input.id },
                    data: { 
                        isPublished: true, 
                        deviceId: null,
                        thumbnailS3Key: thumbnailS3Key,
                        visibility: req.input.visibility
                    },
                    include: TIMELAPSE_INCLUDES
                });

                return apiOk({ timelapse: dtoOwnedTimelapse(publishedTimelapse) });
            }
            catch (error) {
                console.error("(timelapse.ts)", "Failed to decrypt and publish timelapse:", error);
                return apiErr("ERROR", "Failed to process timelapse for publishing");
            }
        }),

    findByUser: publicProcedure("GET", "/timelapse/findByUser")
        .summary("Finds all timelapses created by a given user.")
        .input(
            z.object({
                user: PublicId,
            })
        )
        .output(
            apiResult({
                timelapses: z.array(TimelapseSchema)
                    .describe("All timelapses created by the user."),
            })
        )
        .query(async (req) => {
            logRequest("timelapse/findByUser", req);
            
            const isViewingSelf = req.ctx.user && req.ctx.user.id === req.input.user;
            const isAdmin = req.ctx.user && (req.ctx.user.permissionLevel in oneOf("ADMIN", "ROOT"));

            const timelapses = await database.timelapse.findMany({
                include: TIMELAPSE_INCLUDES,
                orderBy: { createdAt: "desc" },
                where: {
                    ownerId: req.input.user,
                    ...when(!isViewingSelf && !isAdmin, {
                        isPublished: true,
                        visibility: "PUBLIC"
                    })
                }
            });

            return apiOk({ timelapses: timelapses.map(x => dtoTimelapse(x, req.ctx.user)) });
        }),

    syncWithHackatime: protectedProcedure(["timelapse:write"], "POST", "/timelapse/syncWithHackatime")
        .summary("Synchronizes a timelapse with a Hackatime project, converting all snapshots into heartbeats. This procedure can only be called once for a timelapse.")
        .input(
            z.object({
                id: PublicId,
                hackatimeProject: z.string().min(1).max(128)
            })
        )
        .output(
            apiResult({
                timelapse: TimelapseSchema
            })
        )
        .mutation(async (req) => {
            logRequest("timelapse/syncWithHackatime", req);
            
            const timelapse = await database.timelapse.findFirst({
                where: { id: req.input.id, ownerId: req.ctx.user.id },
                include: { owner: true }
            });

            if (!timelapse)
                return apiErr("NOT_FOUND", "Couldn't find that timelapse!");

            if (timelapse.hackatimeProject)
                return apiErr("HACKATIME_ERROR", "Timelapse already has an associated Hackatime project");

            if (!timelapse.owner.hackatimeId || !timelapse.owner.hackatimeAccessToken)
                return apiErr("ERROR", "You must have a linked Hackatime account to sync with Hackatime!");

            let userApiKey: string | null;

            if (process.env.NODE_ENV !== "production" && env.DEV_HACKATIME_FALLBACK_KEY) {
                userApiKey = env.DEV_HACKATIME_FALLBACK_KEY;
            }
            else {
                const oauthApi = new HackatimeOAuthApi(timelapse.owner.hackatimeAccessToken);
                userApiKey = await oauthApi.apiKey();
            }

            if (!userApiKey)
                return apiErr("ERROR", "You don't have a Hackatime account! Create one at https://hackatime.hackclub.com.");

            const hackatime = new HackatimeUserApi(userApiKey);
            
            const snapshots = await database.snapshot.findMany({
                where: { timelapseId: timelapse.id }
            });

            const heartbeats: WakaTimeHeartbeat[] = snapshots.map(x => ({
                entity: `${timelapse.name} (${timelapse.id})`,
                time: x.createdAt.getTime() / 1000,
                category: "timelapsing",
                type: "timelapse",
                user_agent: "wakatime/lapse (lapse) lapse/0.1.0 lapse/0.1.0",
                project: req.input.hackatimeProject
            }));

            const assignedHeartbeats = await hackatime.pushHeartbeats(heartbeats);
            const failedHeartbeat = assignedHeartbeats.responses.find(x => x[1] < 200 || x[1] > 299);
            if (failedHeartbeat) {
                logError("timelapse.syncWithHackatime", "Couldn't sync heartbeat!", { failedHeartbeat, snapshots, heartbeats });
                return apiErr("HACKATIME_ERROR", `Hackatime returned HTTP ${failedHeartbeat[1]} for heartbeat at ${failedHeartbeat[0]?.time}! Report this at https://github.com/hackclub/lapse.`);
            }

            logInfo("timelapse.syncWithHackatime", `Synchronizing ${heartbeats.length} heartbeats with ${timelapse.owner.handle}'s project ${req.input.hackatimeProject}`);
            await Promise.all(
                assignedHeartbeats.responses
                    .map(x => x[0])
                    .map(async (heartbeat) => {
                        const snapshot = closest(heartbeat.time!, snapshots, x => x.createdAt.getTime() / 1000);
                        
                        await database.snapshot.update({
                            where: { id: snapshot.id },
                            data: { heartbeatId: heartbeat.id }
                        });
                    })
            );

            logInfo("timelapse.syncWithHackatime", `All heartbeats synchronized with snapshots for ${timelapse.owner.handle}'s project ${req.input.hackatimeProject}!`);

            const updatedTimelapse = await database.timelapse.update({
                where: { id: req.input.id, ownerId: req.ctx.user.id },
                data: { hackatimeProject: req.input.hackatimeProject },
                include: TIMELAPSE_INCLUDES
            });

            return apiOk({ timelapse: dtoTimelapse(updatedTimelapse, req.ctx.user) });
        })
});
