import { z } from "zod";
import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

import { PrismaClient } from "../../../generated/prisma";
import type { Timelapse as DbTimelapse } from "../../../generated/prisma";
import { procedure, router, protectedProcedure } from "../../trpc";
import { apiResult, ascending, err, match, when, ok, oneOf } from "@/shared/common";
import { encryptString, decryptVideoWithTimelapseId } from "@/server/encryption";
import * as env from "@/server/env";
import { MAX_VIDEO_FRAME_COUNT, MAX_VIDEO_STREAM_SIZE } from "@/shared/constants";

const db = new PrismaClient();
const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${env.S3_ENDPOINT}`,
    credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
});

/**
 * Converts a database representation of a timelapse to a runtime (API) one.
 */
export function dtoTimelapse(entity: DbTimelapse): Timelapse {
    const s3Url = entity.isPublished ? env.S3_PUBLIC_URL_PUBLIC : env.S3_PUBLIC_URL_ENCRYPTED;

    return {
        id: entity.id,
        owner: entity.ownerId,
        isPublished: entity.isPublished,
        hackatimeProject: entity.hackatimeProject ?? undefined,
        playbackUrl: `${s3Url}/${entity.s3Key}`,
        videoContainerKind: entity.containerKind,
        deviceId: entity.deviceId,
        mutable: {
            name: entity.name,
            description: entity.description,
            privacy: entity.privacy as TimelapsePrivacy
        },
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

/**
 * Represents the fields of a timelapse that can be mutated by the user.
 */
export type TimelapseMutable = z.infer<typeof TimelapseMutableSchema>;
export const TimelapseMutableSchema = z.object({
    name: z.string().min(2).max(60),
    description: z.string().max(280).default(""),
    privacy: TimelapsePrivacySchema
});

/**
 * Represents a timelapse entity.
 */
export type Timelapse = z.infer<typeof TimelapseSchema>;
export const TimelapseSchema = z.object({
    /**
     * The ID of timelapse.
     */
    id: z.uuid(),

    /**
     * The ID of the creator of the timelapse.
     */
    owner: z.uuid(),

    /**
     * The device the timelapse has been created on. This determines which passkey it has been
     * encrypted with.
     */
    deviceId: z.uuid(),

    /**
     * If `true`, the timelapse has been published and is _not_ encrypted.
     */
    isPublished: z.boolean(),

    /**
     * The public URL that can be used to stream video data. If `isPublished` is `false`, the
     * video data will be encrypted with a device's passkey.
     */
    playbackUrl: z.url(),

    /**
     * The Hackatime project that has been associated with the timelapse. If `null`, no 
     */
    hackatimeProject: z.string().optional(),

    /**
     * The format of the video container.
     */
    videoContainerKind: TimelapseVideoContainerSchema,

    /**
     * Fields editable by the user.
     */
    mutable: TimelapseMutableSchema
});

export default router({
    /**
     * Finds a timelapse by its ID. If the timelapse is not yet published, and the user does not own
     * the timelapse, the endpoint will report that the timelapse does not exist.
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
            const timelapse = await db.timelapse.findFirst({
                where: { id: req.input.id },
            });

            if (!timelapse)
                return err("NOT_FOUND", "Timelapse not found");

            // Check if user can access this timelapse
            const canAccess =
                timelapse.isPublished ||
                (req.ctx.user && req.ctx.user.id === timelapse.ownerId) ||
                (req.ctx.user && (req.ctx.user.permissionLevel in oneOf("ADMIN", "ROOT")));

            if (!canAccess)
                return err("NOT_FOUND", "Timelapse not found");

            return ok({ timelapse: dtoTimelapse(timelapse) });
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

            const draft = await db.draftTimelapse.create({
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

                /**
                 * Mutable timelapse metadata.
                 */
                mutable: TimelapseMutableSchema,

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
                timelapse: TimelapseSchema,
            })
        )
        .mutation(async (req) => {
            const draft = await db.draftTimelapse.findFirst({
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

            const timelapse = await db.timelapse.create({
                data: {
                    id: draft.id,
                    ownerId: req.ctx.user.id,
                    name: req.input.mutable.name,
                    description: req.input.mutable.description,
                    privacy: req.input.mutable.privacy,
                    containerKind: draft.containerKind,
                    isPublished: false,
                    s3Key: draft.s3Key,
                    deviceId: req.input.deviceId
                }
            });

            const sortedSnapshots = req.input.snapshots.sort(ascending());
            
            await db.snapshot.createMany({
                data: sortedSnapshots.map((x, i) => ({
                    timelapseId: timelapse.id,
                    frame: i,
                    createdAt: new Date(x)
                }))
            });

            await db.draftTimelapse.delete({
                where: { id: draft.id }
            });

            return ok({ timelapse: dtoTimelapse(timelapse) });
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
                changes: TimelapseMutableSchema.partial(),
            })
        )
        .output(
            apiResult({
                /**
                 * The new state of the timelapse, after applying the updates.
                 */
                timelapse: TimelapseSchema,
            })
        )
        .mutation(async (req) => {
            const timelapse = await db.timelapse.findFirst({
                where: { id: req.input.id },
            });

            if (!timelapse)
                return err("NOT_FOUND", "Timelapse not found");

            const canEdit =
                req.ctx.user.id === timelapse.ownerId ||
                req.ctx.user.permissionLevel in oneOf("ADMIN", "ROOT");

            if (!canEdit)
                return err("NOT_FOUND", "You don't have permission to edit this timelapse");

            if (timelapse.isPublished)
                return err("NOT_MUTABLE", "Cannot edit published timelapse");

            const updateData: Partial<DbTimelapse> = {};
            if (req.input.changes.name) {
                updateData.name = req.input.changes.name;
            }

            if (req.input.changes.description !== undefined) {
                updateData.description = req.input.changes.description;
            }

            if (req.input.changes.privacy) {
                updateData.privacy = req.input.changes.privacy;
            }

            const updatedTimelapse = await db.timelapse.update({
                where: { id: req.input.id },
                data: updateData,
            });

            return ok({ timelapse: dtoTimelapse(updatedTimelapse) });
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
            const timelapse = await db.timelapse.findFirst({
                where: { id: req.input.id },
            });

            if (!timelapse)
                return err("NOT_FOUND", "Timelapse not found");

            const canDelete =
                req.ctx.user.id === timelapse.ownerId ||
                req.ctx.user.permissionLevel in oneOf("ADMIN", "ROOT");

            if (!canDelete)
                return err("NO_PERMISSION", "You don't have permission to delete this timelapse");

            await db.timelapse.delete({
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
                timelapse: TimelapseSchema,
            })
        )
        .mutation(async (req) => {
            const timelapse = await db.timelapse.findFirst({
                where: { id: req.input.id },
            });

            if (!timelapse)
                return err("NOT_FOUND", "Timelapse not found");

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

                const decryptedBuffer = decryptVideoWithTimelapseId(
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

                const publishedTimelapse = await db.timelapse.update({
                    where: { id: req.input.id },
                    data: { isPublished: true },
                });

                return ok({ timelapse: dtoTimelapse(publishedTimelapse) });
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

            const timelapses = await db.timelapse.findMany({
                where: {
                    ownerId: req.input.user,
                    ...when(!isViewingSelf && !isAdmin, {
                        isPublished: true,
                        privacy: "PUBLIC"
                    })
                }
            });

            return ok({
                timelapses: timelapses.map(dtoTimelapse),
            });
        }),

    /**
     * Synchronizes a timelapse with a Hackatime project, converting all snapshots into heartbeats.
     * This procedure can only be called **once** for a timelapse.
     */
    syncWithHackatime: procedure
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
            const timelapse = await db.timelapse.findFirst({
                where: { id: req.input.id }
            });

            if (!timelapse)
                return err("NOT_FOUND", "Timelapse not found");

            if (timelapse.hackatimeProject)
                return err("HACKATIME_ALREADY_ASSIGNED", "Timelapse already has an associated Hackatime project");

            const updatedTimelapse = await db.timelapse.update({
                where: { id: req.input.id },
                data: { hackatimeProject: req.input.hackatimeProject }
            });

            return ok({ timelapse: dtoTimelapse(updatedTimelapse) });
        })
});
