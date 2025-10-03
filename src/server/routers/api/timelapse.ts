import { z } from "zod";
import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import crypto from "crypto";

import { PrismaClient } from "../../../generated/prisma";
import type { Timelapse as DbTimelapse } from "../../../generated/prisma";
import { procedure, router, protectedProcedure } from "../../trpc";
import { apiResult, ascending, err, match, ok, oneOf } from "@/shared/common";
import { decryptString, encryptString } from "@/server/encryption";
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
    const s3Bucket = entity.isPublished ? env.S3_PUBLIC_URL_PUBLIC : env.S3_PUBLIC_URL_ENCRYPTED;

    return {
        id: entity.id,
        owner: entity.ownerId,
        isPublished: entity.isPublished,
        hackatimeProject: entity.hackatimeProject ?? undefined,
        playbackUrl: `${s3Bucket}/${entity.s3Key}`,
        videoContainerKind: entity.containerKind,
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

function containerTypeToMimeType(container: TimelapseVideoContainer) {
    return match(container, {
        "MP4": "video/mp4" as const,
        "WEBM": "video/webm" as const
    });
}

function containerTypeToExtension(container: TimelapseVideoContainer) {
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
    id: z.uuid(),
    owner: z.uuid(),
    isPublished: z.boolean(),
    playbackUrl: z.url(),
    hackatimeProject: z.string().optional(),
    videoContainerKind: TimelapseVideoContainerSchema,
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

            if (!timelapse) {
                return { ok: false, error: "Timelapse not found" };
            }

            // Check if user can access this timelapse
            const canAccess =
                timelapse.isPublished ||
                (req.ctx.user && req.ctx.user.id === timelapse.ownerId) ||
                (req.ctx.user && (req.ctx.user.permissionLevel in oneOf("ADMIN", "ROOT")));

            if (!canAccess) {
                return { ok: false, error: "Timelapse not found" };
            }

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
                 * An opaque key that refers to the upload after uploading.
                 */
                key: z.string()
            })
        )
        .query(async (req) => {
            const key = `timelapses/${req.ctx.user.id}/${crypto.randomUUID()}.${containerTypeToExtension(req.input.containerType)}`;

            const command = new PutObjectCommand({
                Bucket: env.S3_ENCRYPTED_BUCKET_NAME,
                Key: key,
                ContentType: containerTypeToMimeType(req.input.containerType)
            });

            const uploadUrl = await getSignedUrl(s3, command, {
                expiresIn: 15 * 60, // 15 minutes
            });

            return ok({
                url: uploadUrl,

                // The key is opaque, but it doesn't really _have_ to be. If the client for some
                // godforsaken reason NEEDS to know the actual bucket key, then we COULD make this
                // a transparent field by just... not encrypting it.
                key: encryptString(key, env.PRIVATE_KEY_UPLOAD_KEY)
            });
        }),

    /**
     * Creates a pre-signed URL for uploading a timelapse video file to R2.
     */
    create: protectedProcedure
        .input(
            z.object({
                /**
                 * Mutable timelapse metadata.
                 */
                mutable: TimelapseMutableSchema,

                /**
                 * An array of Unix timestamps. The frame count is inferred by sorting the array,
                 * and always begins at 0.
                 */
                snapshots: z.array(z.int().min(0)).max(MAX_VIDEO_FRAME_COUNT),

                /**
                 * The key provided by the `beginUpload` API endpoint.
                 */
                uploadKey: z.hex()
            })
        )
        .output(
            apiResult({
                timelapse: TimelapseSchema,
            })
        )
        .mutation(async (req) => {
            const s3Key = decryptString(req.input.uploadKey, env.PRIVATE_KEY_UPLOAD_KEY);
            if (!s3Key)
                return err("Invalid upload key.");

            let containerKind: TimelapseVideoContainer | null = null;

            try {
                const getCommand = new GetObjectCommand({
                    Bucket: env.S3_ENCRYPTED_BUCKET_NAME,
                    Key: s3Key,
                });

                const object = await s3.send(getCommand);
                const fileSizeBytes = object.ContentLength ?? 0;

                containerKind = !object.ContentType ? null
                    : object.ContentType.includes("video/webm") ? "WEBM"
                    : object.ContentType.includes("video/mp4") ? "MP4"
                    : null; // unrecognized?!

                if (fileSizeBytes > MAX_VIDEO_STREAM_SIZE || !containerKind) {
                    const deleteCommand = new DeleteObjectCommand({
                        Bucket: env.S3_ENCRYPTED_BUCKET_NAME,
                        Key: s3Key,
                    });

                    await s3.send(deleteCommand);
                    
                    return err("Video stream exceeds size limit or has an invalid content type");
                }
            }
            catch {
                return err("Uploaded file not found.");
            }

            const timelapse = await db.timelapse.create({
                data: {
                    ownerId: req.ctx.user.id,
                    name: req.input.mutable.name,
                    description: req.input.mutable.description,
                    privacy: req.input.mutable.privacy,
                    containerKind: containerKind,
                    isPublished: false,
                    s3Key: s3Key
                },
            });

            const sortedSnapshots = req.input.snapshots.sort(ascending());
            await db.snapshot.createMany({
                data: sortedSnapshots.map((x, i) => ({
                    timelapseId: timelapse.id,
                    frame: i,
                    createdAt: new Date(x * 1000)
                }))
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

            if (!timelapse) {
                return { ok: false, error: "Timelapse not found" };
            }

            const canEdit =
                req.ctx.user.id === timelapse.ownerId ||
                req.ctx.user.permissionLevel in oneOf("ADMIN", "ROOT");

            if (!canEdit) {
                return {
                    ok: false,
                    error: "You don't have permission to edit this timelapse",
                };
            }

            if (timelapse.isPublished) {
                return { ok: false, error: "Cannot edit published timelapse" };
            }

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

            if (!timelapse) {
                return { ok: false, error: "Timelapse not found" };
            }

            const canDelete =
                req.ctx.user.id === timelapse.ownerId ||
                req.ctx.user.permissionLevel in oneOf("ADMIN", "ROOT");

            if (!canDelete) {
                return {
                    ok: false,
                    error: "You don't have permission to delete this timelapse",
                };
            }

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
                 * The 256-bit key used to encrypt the snapshots, serialized as a hex string.
                 */
                key: z.hex().length(256 / 4),

                /**
                 * The 128-bit initialization vector (IV) used to encrypt the snapshot, serialized as a hex string.
                 */
                iv: z.hex().length(128 / 4)
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
                return { ok: false, error: "Timelapse not found" };

            const canPublish =
                req.ctx.user.id === timelapse.ownerId ||
                req.ctx.user.permissionLevel in oneOf("ADMIN", "ROOT");

            if (!canPublish) {
                return {
                    ok: false,
                    error: "You don't have permission to publish this timelapse",
                };
            }

            if (timelapse.isPublished) {
                return { ok: false, error: "Timelapse already published" };
            }

            try {
                const getCommand = new GetObjectCommand({
                    Bucket: env.S3_ENCRYPTED_BUCKET_NAME,
                    Key: timelapse.s3Key
                });

                const encryptedObject = await s3.send(getCommand);
                const encryptedBuffer = await encryptedObject.Body?.transformToByteArray();

                if (!encryptedBuffer) {
                    return { ok: false, error: "Failed to retrieve encrypted video" };
                }

                const decipher = crypto.createDecipheriv(
                    "aes-256-cbc",
                    Buffer.from(req.input.key, "hex"),
                    Buffer.from(req.input.iv, "hex")
                );
                
                const decryptedBuffer = Buffer.concat([
                    decipher.update(Buffer.from(encryptedBuffer)),
                    decipher.final(),
                ]);

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
                return {
                    ok: false,
                    error: "Failed to process timelapse for publishing",
                };
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

            const whereClause: {
                ownerId: string;
                isPublished?: boolean;
                privacy?: "PUBLIC" | "UNLISTED";
            } = { ownerId: req.input.user };

            // If not viewing self and not admin, only show published public timelapses
            if (!isViewingSelf && !isAdmin) {
                whereClause.isPublished = true;
                whereClause.privacy = "PUBLIC";
            }

            const timelapses = await db.timelapse.findMany({
                where: whereClause,
            });

            return ok({
                timelapses: timelapses.map(dtoTimelapse),
            });
        }),
});
