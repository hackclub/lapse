import "@/server/allow-only-server";

import { z } from "zod";
import { S3Client } from "@aws-sdk/client-s3";
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

import { PrismaClient } from "@/generated/prisma";
import { procedure, router, protectedProcedure } from "@/server/trpc";
import { apiResult, ascending, err, match, when, ok, oneOf, closest, chunked, assert } from "@/shared/common";
import { decryptVideo } from "@/server/encryption";
import * as env from "@/server/env";
import { MAX_THUMBNAIL_UPLOAD_SIZE, MAX_VIDEO_FRAME_COUNT, MAX_VIDEO_STREAM_SIZE, MAX_VIDEO_UPLOAD_SIZE, UPLOAD_TOKEN_LIFETIME_MS } from "@/shared/constants";
import { dtoKnownDevice, dtoPublicUser, KnownDeviceSchema, PublicUserSchema } from "@/server/routers/api/user";
import * as db from "@/generated/prisma";
import { Hackatime, WakaTimeHeartbeat } from "@/server/hackatime";
import { logError, logInfo } from "@/server/serverCommon";
import { generateThumbnail } from "@/server/videoProcessing";
import { PublicId } from "../common";

const database = new PrismaClient();
const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${env.S3_ENDPOINT}`,
    credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
});

/**
 * Represents a `db.Timelapse` with related tables included.
 */
export type DbCompositeTimelapse = db.Timelapse & { owner: db.User, device: db.KnownDevice | null };

export function dtoTimelapse(entity: DbCompositeTimelapse): Timelapse {
    // This lacks `isPublished` so that we have to mark it explicitly when creating a DTO
    // that might hold private data (e.g. device names).
    return {
        id: entity.id,
        owner: dtoPublicUser(entity.owner),
        name: entity.name,
        description: entity.description,
        visibility: entity.visibility,
        playbackUrl: `${entity.isPublished ? env.S3_PUBLIC_URL_PUBLIC : env.S3_PUBLIC_URL_ENCRYPTED}/${entity.s3Key}`,
        thumbnailUrl: entity.thumbnailS3Key 
            ? `${entity.isPublished ? env.S3_PUBLIC_URL_PUBLIC : env.S3_PUBLIC_URL_ENCRYPTED}/${entity.thumbnailS3Key}`
            : null,
        videoContainerKind: entity.containerKind,
        isPublished: entity.isPublished
    };
}

/**
 * Converts a database representation of a timelapse to a runtime (API) one, including all private fields.
 */
export function dtoOwnedTimelapse(entity: DbCompositeTimelapse): OwnedTimelapse {
    return {
        ...dtoTimelapse(entity),
        private: {
            device: entity.device ? dtoKnownDevice(entity.device) : null,
            hackatimeProject: entity.hackatimeProject
        }
    };
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
 * Permanently deletes a timelapse, including all its snapshots and S3 files.
 */
export async function deleteTimelapse(timelapseId: string): Promise<void> {
    const timelapse = await database.timelapse.findFirst({
        where: { id: timelapseId }
    });

    if (!timelapse)
        throw new Error(`Timelapse ${timelapseId} not found`);

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

export default router({
    /**
     * Finds a timelapse by its ID. If the timelapse is not yet published, and the user does not own
     * the timelapse, the endpoint will report that the timelapse does not exist.
     * 
     * This endpoint will return a different view if the user owns the timelapse.
     */
    query: procedure
        .input(
            z.object({
                /**
                 * The ID of the timelapse to query information about.
                 */
                id: PublicId,
            })
        )
        .output(
            apiResult({
                timelapse: TimelapseSchema,
            })
        )
        .query(async (req) => {
            logInfo("snapshot/query", req.input);
            
            const timelapse = await database.timelapse.findFirst({
                where: { id: req.input.id },
                include: { owner: true, device: true }
            });

            if (!timelapse)
                return err("NOT_FOUND", "Couldn't find that timelapse!");

            const isOwner = (req.ctx.user && req.ctx.user.id === timelapse.ownerId) ||
                (req.ctx.user && (req.ctx.user.permissionLevel in oneOf("ADMIN", "ROOT")));

            if (!timelapse.isPublished && !isOwner)
                return err("NOT_FOUND", "Couldn't find that timelapse!");

            return ok({ timelapse: isOwner ? dtoOwnedTimelapse(timelapse) : dtoTimelapse(timelapse) });
        }),

    /**
     * Creates a draft timelapse. Draft timelapses can be *commited* and turned into regular timelapses
     * by calling `timelapse.commit`. Before a draft timelapse is commited, all AES-256-CBC encrypted
     * data must be uploaded to the server using both the `videoToken` and the `thumbnailToken`
     * via `/api/upload`.
     * 
     * The key or IV that the data is encrypted should be derived from the device passkey and timelapse ID.
     * Other key/IV values will make the server unable to decrypt the timelapse.
     * 
     * This endpoint is planned to support chunked video uploads in the future. This will make draft
     * timelapses have a longer lifespan, with their upload tokens being able to be re-used.
     */
    createDraft: protectedProcedure()
        .input(z.object({
            /**
             * The container format of the video stream. This will be used to derive the MIME type
             * of the video.
             */
            containerType: TimelapseVideoContainerSchema
        }))
        .output(
            apiResult({
                /**
                 * The ID that identifies the draft timelapse. When created, the resulting timelapse
                 * will be identified by this value. 
                 */
                id: PublicId,

                /**
                 * Authorizes the client to upload the encrypted video via `/api/upload`.
                 */
                videoToken: z.uuid(),

                /**
                 * Authorizes the client to upload the encrypted thumbnail via `/api/upload`.
                 */
                thumbnailToken: z.uuid()
            })
        )
        .query(async (req) => {
            logInfo("timelapse/createDraft", req.input);
            const baseId = crypto.randomUUID();

            const video = await database.uploadToken.create({
                data: {
                    ownerId: req.ctx.user.id,
                    bucket: env.S3_ENCRYPTED_BUCKET_NAME,
                    key: `timelapses/${req.ctx.user.id}/${baseId}.${containerTypeToExtension(req.input.containerType)}`,
                    mimeType: containerTypeToMimeType(req.input.containerType),
                    expires: new Date(new Date().getTime() + UPLOAD_TOKEN_LIFETIME_MS),
                    maxSize: MAX_VIDEO_UPLOAD_SIZE
                }
            });

            const thumbnail = await database.uploadToken.create({
                data: {
                    ownerId: req.ctx.user.id,
                    bucket: env.S3_ENCRYPTED_BUCKET_NAME,
                    key: `timelapses/${req.ctx.user.id}/${baseId}-thumbnail.jpg`,
                    mimeType: "image/jpeg",
                    expires: new Date(new Date().getTime() + UPLOAD_TOKEN_LIFETIME_MS),
                    maxSize: MAX_THUMBNAIL_UPLOAD_SIZE
                }
            });

            const draft = await database.draftTimelapse.create({
                data: {
                    ownerId: req.ctx.user.id,
                    videoTokenId: video.id,
                    thumbnailTokenId: thumbnail.id,
                }
            });

            return ok({ id: draft.id, videoToken: video.id, thumbnailToken: thumbnail.id });
        }),

    /**
     * Commits a draft timelapse.
     */
    commit: protectedProcedure()
        .input(
            z.object({
                id: PublicId,
                name: TimelapseName,
                description: TimelapseDescription,
                visibility: TimelapseVisibilitySchema,

                /**
                 * An array of timestamps. Each timestamp counts the number of milliseconds since the
                 * Unix epoch - equivalent to `Date.getTime()` in JavaScript. The frame count is
                 * inferred by sorting the array, and always begins at 0.
                 */
                snapshots: z.array(z.int().min(0)).max(MAX_VIDEO_FRAME_COUNT),

                /**
                 * The device that the timelapse has been created on. This generally is used to
                 * let other devices know what key to use to decrypt this timelapse.
                 */
                deviceId: z.uuid()
            })
        )
        .output(
            apiResult({
                timelapse: OwnedTimelapseSchema,
            })
        )
        .mutation(async (req) => {
            logInfo("snapshot/create", req.input);

            const draft = await database.draftTimelapse.findFirst({
                where: { id: req.input.id, ownerId: req.ctx.user.id },
                include: { videoToken: true, thumbnailToken: true }
            });

            if (!draft)
                return err("NOT_FOUND", `The draft timelapse ${req.input.id} couldn't be found.`);

            const videoUpload = draft.videoToken;
            const thumbnailUpload = draft.thumbnailToken;

            assert(videoUpload.ownerId == req.ctx.user.id, "Video upload token wasn't owned by draft owner");
            assert(thumbnailUpload.ownerId == req.ctx.user.id, "Thumbnail upload token wasn't owned by draft owner");

            if (!videoUpload.uploaded)
                return err("NO_FILE", "The video hasn't yet been uploaded.");

            if (!thumbnailUpload.uploaded)
                return err("NO_FILE", "The thumbnail hasn't yet been uploaded.");

            const device = await database.knownDevice.findFirst({
                where: { id: req.input.deviceId }
            });

            if (!device)
                return err("DEVICE_NOT_FOUND", "The device creating this snapshot hasn't been registered with the server.");

            if (device.ownerId != req.ctx.user.id)
                return err("NO_PERMISSION", "The specified device doesn't belong to the logged in user.");

            const timelapse = await database.timelapse.create({
                include: { owner: true, device: true },
                data: {
                    id: draft.id,
                    ownerId: req.ctx.user.id,
                    name: req.input.name,
                    description: req.input.description,
                    visibility: req.input.visibility,
                    containerKind: mimeTypeToContainerType(videoUpload.mimeType),
                    isPublished: false,
                    s3Key: videoUpload.key,
                    thumbnailS3Key: thumbnailUpload.key,
                    deviceId: req.input.deviceId
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

            // This will cascade and remove the upload tokens as well.
            await database.draftTimelapse.delete({
                where: { id: draft.id }
            });

            return ok({ timelapse: dtoOwnedTimelapse(timelapse) });
        }),

    /**
     * Updates the metadata of a timelapse.
     */
    update: protectedProcedure()
        .input(
            z.object({
                /**
                 * The ID of the timelapse to update.
                 */
                id: PublicId,

                /**
                 * The changes to apply to the timelapse.
                 */
                changes: z.object({
                    name: TimelapseName.optional(),
                    description: TimelapseDescription.optional(),
                    visibility: TimelapseVisibilitySchema.optional()
                })
            })
        )
        .output(
            apiResult({
                /**
                 * The new state of the timelapse, after applying the updates.
                 */
                timelapse: OwnedTimelapseSchema,
            })
        )
        .mutation(async (req) => {
            logInfo("snapshot/update", req.input);

            const timelapse = await database.timelapse.findFirst({
                where: { id: req.input.id },
            });

            if (!timelapse)
                return err("NOT_FOUND", "Couldn't find that timelapse!");

            const canEdit =
                req.ctx.user.id === timelapse.ownerId ||
                req.ctx.user.permissionLevel in oneOf("ADMIN", "ROOT");

            if (!canEdit)
                return err("NOT_FOUND", "You don't have permission to edit this timelapse");

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
                include: { owner: true, device: true }
            });

            return ok({ timelapse: dtoOwnedTimelapse(updatedTimelapse) });
        }),

    /**
     * Permanently deletes a timelapse owned by the user.
     */
    delete: protectedProcedure()
        .input(
            z.object({
                id: PublicId,
            })
        )
        .output(apiResult({}))
        .mutation(async (req) => {
            logInfo("snapshot/delete", req.input);

            const timelapse = await database.timelapse.findFirst({
                where: { id: req.input.id },
            });

            if (!timelapse)
                return err("NOT_FOUND", "Couldn't find that timelapse!");

            const canDelete =
                req.ctx.user.id === timelapse.ownerId ||
                req.ctx.user.permissionLevel in oneOf("ADMIN", "ROOT");

            if (!canDelete)
                return err("NO_PERMISSION", "You don't have permission to delete this timelapse");

            try {
                await deleteTimelapse(req.input.id);
                return ok({});
            }
            catch (error) {
                logError("timelapse.delete", "Failed to delete timelapse:", error);
                return err("ERROR", "Failed to delete timelapse");
            }
        }),

    /**
     * Publishes a timelapse, making it immutable and accessible by administrators. This will decrypt
     * all of the segments contained within the timelapse. If not unlisted, will also make the timelapse public.
     */
    publish: protectedProcedure()
        .input(
            z.object({
                /**
                 * The ID of the timelapse to published.
                 */
                id: PublicId,

                /**
                 * The device passkey used to decrypt the timelapse.
                 */
                passkey: z.string().length(6)
            })
        )
        .output(
            apiResult({
                /**
                 * The new state of the timelapse, after publishing.
                 */
                timelapse: OwnedTimelapseSchema,
            })
        )
        .mutation(async (req) => {
            logInfo("timelapse/publish", req.input);
            
            const timelapse = await database.timelapse.findFirst({
                where: { id: req.input.id },
            });

            if (!timelapse)
                return err("NOT_FOUND", "Couldn't find that timelapse!");

            const canPublish =
                req.ctx.user.id === timelapse.ownerId ||
                req.ctx.user.permissionLevel in oneOf("ADMIN", "ROOT");

            if (!canPublish)
                return err("NO_PERMISSION", "You don't have permission to publish this timelapse");

            if (timelapse.isPublished)
                return err("ALREADY_PUBLISHED", "Timelapse already published");

            try {
                const encryptedObject = await s3.send(new GetObjectCommand({
                    Bucket: env.S3_ENCRYPTED_BUCKET_NAME,
                    Key: timelapse.s3Key
                }));

                const encryptedBuffer = await encryptedObject.Body?.transformToByteArray();

                if (!encryptedBuffer)
                    return err("NO_FILE", "Failed to retrieve encrypted video");

                let decryptedBuffer: Buffer;

                try {
                    decryptedBuffer = decryptVideo(
                        encryptedBuffer,
                        req.input.id,
                        req.input.passkey
                    );
                }
                catch {
                    return err("ERROR", "Invalid passkey provided. Please check your 6-digit PIN.");
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
                    console.warn("Failed to generate thumbnail for published timelapse:", thumbnailError);
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
                        thumbnailS3Key: thumbnailS3Key
                    },
                    include: { owner: true, device: true }
                });

                return ok({ timelapse: dtoOwnedTimelapse(publishedTimelapse) });
            }
            catch (error) {
                console.error("Failed to decrypt and publish timelapse:", error);
                return err("ERROR", "Failed to process timelapse for publishing");
            }
        }),

    /**
     * Finds all timelapses created by a given user.
     */
    findByUser: procedure
        .input(
            z.object({
                user: PublicId,
            })
        )
        .output(
            apiResult({
                /**
                 * All timelapses created by the user.
                 */
                timelapses: z.array(TimelapseSchema),
            })
        )
        .query(async (req) => {
            logInfo("timelapse/findByUser", req.input);
            
            const isViewingSelf = req.ctx.user && req.ctx.user.id === req.input.user;
            const isAdmin = req.ctx.user && (req.ctx.user.permissionLevel in oneOf("ADMIN", "ROOT"));

            const timelapses = await database.timelapse.findMany({
                include: { owner: true, device: true },
                where: {
                    ownerId: req.input.user,
                    ...when(!isViewingSelf && !isAdmin, {
                        isPublished: true,
                        visibility: "PUBLIC"
                    })
                }
            });

            return ok({
                timelapses: timelapses.map(x => x.ownerId == req.ctx.user?.id ? dtoOwnedTimelapse(x) : dtoTimelapse(x) ),
            });
        }),

    /**
     * Synchronizes a timelapse with a Hackatime project, converting all snapshots into heartbeats.
     * This procedure can only be called **once** for a timelapse.
     */
    syncWithHackatime: protectedProcedure()
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
            logInfo("timelapse/syncWithHackatime", req.input);
            
            const timelapse = await database.timelapse.findFirst({
                where: { id: req.input.id, ownerId: req.ctx.user.id },
                include: { owner: true }
            });

            if (!timelapse)
                return err("NOT_FOUND", "Couldn't find that timelapse!");

            if (timelapse.hackatimeProject)
                return err("HACKATIME_ERROR", "Timelapse already has an associated Hackatime project");

            if (!timelapse.owner.hackatimeApiKey)
                return err("ERROR", "You don't have a Hackatime API key assigned to your profile!");

            const hackatime = new Hackatime(timelapse.owner.hackatimeApiKey);
            
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
                logError("timelapse.syncWithHackatime", "Couldn't sync heartbeat:", failedHeartbeat);
                logError("timelapse.syncWithHackatime", "All snapshots:", snapshots);
                logError("timelapse.syncWithHackatime", "All heartbeats:", heartbeats);
                return err("HACKATIME_ERROR", `Hackatime returned HTTP ${failedHeartbeat[1]} for heartbeat at ${failedHeartbeat[0]?.time}! Report this at https://github.com/hackclub/lapse.`);
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
                include: { owner: true, device: true }
            });

            return ok({ timelapse: dtoOwnedTimelapse(updatedTimelapse) });
        }),


});
