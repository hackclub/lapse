import "@/server/allow-only-server";

import { iso, z } from "zod";
import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

import { PrismaClient } from "../../../generated/prisma";
import { procedure, router, protectedProcedure } from "../../trpc";
import { apiResult, ascending, err, match, when, ok, oneOf, assert } from "@/shared/common";
import { decryptVideo } from "@/server/encryption";
import * as env from "@/server/env";
import { MAX_VIDEO_FRAME_COUNT, MAX_VIDEO_STREAM_SIZE } from "@/shared/constants";
import { dtoKnownDevice, dtoPublicUser, KnownDeviceSchema, PublicUserSchema } from "./user";
import * as db from "@/generated/prisma";

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
        privacy: entity.privacy,
        playbackUrl: `${entity.isPublished ? env.S3_PUBLIC_URL_PUBLIC : env.S3_PUBLIC_URL_ENCRYPTED}/${entity.s3Key}`,
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
 * Represents the possible privacy settings for a published timelapse.
 */
export type TimelapsePrivacy = z.infer<typeof TimelapsePrivacySchema>;
export const TimelapsePrivacySchema = z.enum(["UNLISTED", "PUBLIC"]);

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
    id: z.uuid(),

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
    privacy: TimelapsePrivacySchema,

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
                 * The UUID of the timelapse to query information about.
                 */
                id: z.uuid(),
            })
        )
        .output(
            apiResult({
                timelapse: TimelapseSchema,
            })
        )
        .query(async (req) => {
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
     * Creates a pre-signed URL for uploading a timelapse video stream. After an upload to the pre-signed
     * URL is complete, `create` may be called with the `key`. The uploaded content has to be encrypted
     * using AES-256-CBC using an arbitrary key that should be provided to `publish`.
     */
    beginUpload: protectedProcedure
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
                 * The pre-signed URL that the client should upload the timelapse video stream to.
                 */
                url: z.url(),

                /**
                 * The UUID of the timelapse that will be created.
                 */
                timelapseId: z.uuid()
            })
        )
        .query(async (req) => {
            // Generate the timelapse ID before upload so it can be used for encryption

            const key = `timelapses/${req.ctx.user.id}/${crypto.randomUUID()}.${containerTypeToExtension(req.input.containerType)}`;

            const command = new PutObjectCommand({
                Bucket: env.S3_ENCRYPTED_BUCKET_NAME,
                Key: key,
                ContentType: containerTypeToMimeType(req.input.containerType)
            });

            const uploadUrl = await getSignedUrl(s3, command, {
                expiresIn: 15 * 60, // 15 minutes
            });

            const draft = await database.draftTimelapse.create({
                data: {
                    ownerId: req.ctx.user.id,
                    containerKind: req.input.containerType,
                    s3Key: key
                }
            });

            return ok({
                url: uploadUrl,
                timelapseId: draft.id
            });
        }),

    /**
     * Creates a pre-signed URL for uploading a timelapse video file to R2.
     */
    create: protectedProcedure
        .input(
            z.object({
                /**
                 * The UUID of the timelapse to be created. Must match the one returned by beginUpload.
                 */
                id: z.uuid(),

                name: TimelapseName,
                description: TimelapseDescription,
                privacy: TimelapsePrivacySchema,

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
            const draft = await database.draftTimelapse.findFirst({
                where: { id: req.input.id, ownerId: req.ctx.user.id }
            });

            if (!draft)
                return err("NOT_FOUND", "Unknown timelapse ID.");

            try {
                const getCommand = new GetObjectCommand({
                    Bucket: env.S3_ENCRYPTED_BUCKET_NAME,
                    Key: draft.s3Key,
                });

                const object = await s3.send(getCommand);
                const fileSizeBytes = object.ContentLength ?? 0;

                if (fileSizeBytes > MAX_VIDEO_STREAM_SIZE) {
                    const deleteCommand = new DeleteObjectCommand({
                        Bucket: env.S3_ENCRYPTED_BUCKET_NAME,
                        Key: draft.s3Key,
                    });

                    await s3.send(deleteCommand);
                    
                    return err("SIZE_LIMIT", "Video stream exceeds size limit.");
                }
            }
            catch {
                return err("NOT_FOUND", "Uploaded file not found.");
            }

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
                    privacy: req.input.privacy,
                    containerKind: draft.containerKind,
                    isPublished: false,
                    s3Key: draft.s3Key,
                    deviceId: req.input.deviceId
                }
            });

            const sortedSnapshots = req.input.snapshots.sort(ascending());
            
            await database.snapshot.createMany({
                data: sortedSnapshots.map((x, i) => ({
                    timelapseId: timelapse.id,
                    frame: i,
                    createdAt: new Date(x)
                }))
            });

            await database.draftTimelapse.delete({
                where: { id: draft.id }
            });

            return ok({ timelapse: dtoOwnedTimelapse(timelapse) });
        }),

    /**
     * Updates a timelapse.
     */
    update: protectedProcedure
        .input(
            z.object({
                /**
                 * The ID of the timelapse to update.
                 */
                id: z.uuid(),

                /**
                 * The changes to apply to the timelapse.
                 */
                changes: z.object({
                    name: TimelapseName.optional(),
                    description: TimelapseDescription.optional(),
                    privacy: TimelapsePrivacySchema.optional()
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

            if (timelapse.isPublished)
                return err("NOT_MUTABLE", "Cannot edit published timelapse");

            const updateData: Partial<db.Timelapse> = {};
            if (req.input.changes.name) {
                updateData.name = req.input.changes.name;
            }

            if (req.input.changes.description !== undefined) {
                updateData.description = req.input.changes.description;
            }

            if (req.input.changes.privacy) {
                updateData.privacy = req.input.changes.privacy;
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
    delete: protectedProcedure
        .input(
            z.object({
                id: z.uuid(),
            })
        )
        .output(apiResult({}))
        .mutation(async (req) => {
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

            await database.timelapse.delete({
                where: { id: req.input.id },
            });

            return ok({});
        }),

    /**
     * Publishes a timelapse, making it immutable and accessible by administrators. This will decrypt
     * all of the segments contained within the timelapse. If not unlisted, will also make the timelapse public.
     */
    publish: protectedProcedure
        .input(
            z.object({
                /**
                 * The UUID of the timelapse to published.
                 */
                id: z.uuid(),

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
                const getCommand = new GetObjectCommand({
                    Bucket: env.S3_ENCRYPTED_BUCKET_NAME,
                    Key: timelapse.s3Key
                });

                const encryptedObject = await s3.send(getCommand);
                const encryptedBuffer = await encryptedObject.Body?.transformToByteArray();

                if (!encryptedBuffer)
                    return err("NO_FILE", "Failed to retrieve encrypted video");

                const decryptedBuffer = decryptVideo(
                    encryptedBuffer,
                    req.input.id,
                    req.input.passkey
                );

                const putCommand = new PutObjectCommand({
                    Bucket: env.S3_PUBLIC_BUCKET_NAME,
                    Key: timelapse.s3Key,
                    Body: decryptedBuffer,
                    ContentType: containerTypeToMimeType(timelapse.containerKind)
                });

                await s3.send(putCommand);

                const deleteCommand = new DeleteObjectCommand({
                    Bucket: env.S3_ENCRYPTED_BUCKET_NAME,
                    Key: timelapse.s3Key,
                });

                await s3.send(deleteCommand);

                const publishedTimelapse = await database.timelapse.update({
                    where: { id: req.input.id },
                    data: { isPublished: true },
                    include: { owner: true, device: true }
                });

                return ok({ timelapse: dtoOwnedTimelapse(publishedTimelapse) });
            }
            catch (error) {
                console.error("Failed to decrypt and publish timelapse:", error);
                
                // Check if this looks like a decryption error
                if (error instanceof Error && error.message.includes("decrypt")) {
                    return err("INVALID_PASSKEY", "Invalid passkey provided. Please check your 6-digit PIN.");
                }
                
                return err("ERROR", "Failed to process timelapse for publishing");
            }
        }),

    /**
     * Finds all timelapses created by a given user.
     */
    findByUser: procedure
        .input(
            z.object({
                user: z.uuid(),
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
            const isViewingSelf = req.ctx.user && req.ctx.user.id === req.input.user;
            const isAdmin = req.ctx.user && (req.ctx.user.permissionLevel in oneOf("ADMIN", "ROOT"));

            const timelapses = await database.timelapse.findMany({
                include: { owner: true, device: true },
                where: {
                    ownerId: req.input.user,
                    ...when(!isViewingSelf && !isAdmin, {
                        isPublished: true,
                        privacy: "PUBLIC"
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
    syncWithHackatime: protectedProcedure
        .input(
            z.object({
                id: z.uuid(),
                hackatimeProject: z.string()
            })
        )
        .output(
            apiResult({
                timelapse: TimelapseSchema
            })
        )
        .mutation(async (req) => {
            const timelapse = await database.timelapse.findFirst({
                where: { id: req.input.id, ownerId: req.ctx.user.id }
            });

            if (!timelapse)
                return err("NOT_FOUND", "Couldn't find that timelapse!");

            if (timelapse.hackatimeProject)
                return err("HACKATIME_ALREADY_ASSIGNED", "Timelapse already has an associated Hackatime project");

            const updatedTimelapse = await database.timelapse.update({
                where: { id: req.input.id, ownerId: req.ctx.user.id },
                data: { hackatimeProject: req.input.hackatimeProject },
                include: { owner: true, device: true }
            });

            return ok({ timelapse: dtoOwnedTimelapse(updatedTimelapse) });
        })
});
