import { z } from "zod";
import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import crypto from "crypto";

import { PrismaClient } from "../../../generated/prisma";
import type { Timelapse as DbTimelapse } from "../../../generated/prisma";
import { procedure, router, protectedProcedure } from "../../trpc";
import { apiResult, ok } from "@/utils/common";

const db = new PrismaClient();
const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
});

/**
 * Converts a database representation of a timelapse to a runtime (API) one.
 */
export function dtoTimelapse(entity: DbTimelapse): Timelapse {
    return {
        id: entity.id,
        owner: entity.ownerId,
        isPublished: entity.isPublished,
        hackatimeProject: entity.hackatimeProject ?? undefined,
        mutable: {
            name: entity.name,
            description: entity.description,
            privacy: entity.privacy as TimelapsePrivacy,
            decryptedChecksum: entity.decryptedChecksum,
        },
    };
}

/**
 * Represents the possible privacy settings for a published timelapse.
 */
export type TimelapsePrivacy = z.infer<typeof TimelapsePrivacySchema>;
export const TimelapsePrivacySchema = z.enum(["UNLISTED", "PUBLIC"]);

/**
 * Represents the fields of a timelapse that can be mutated by the user.
 */
export type TimelapseMutable = z.infer<typeof TimelapseMutableSchema>;
export const TimelapseMutableSchema = z.object({
    name: z.string().min(2),
    description: z.string().default(""),
    privacy: TimelapsePrivacySchema,
    decryptedChecksum: z.hex().length(32 / 4),
});

/**
 * Represents a timelapse entity.
 */
export type Timelapse = z.infer<typeof TimelapseSchema>;
export const TimelapseSchema = z.object({
    id: z.uuid(),
    owner: z.uuid(),
    isPublished: z.boolean(),
    hackatimeProject: z.string().optional(),
    mutable: TimelapseMutableSchema,
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
        .query(async ({ ctx, input }) => {
            const timelapse = await db.timelapse.findFirst({
                where: { id: input.id },
            });

            if (!timelapse) {
                return { ok: false, error: "Timelapse not found" };
            }

            // Check if user can access this timelapse
            const canAccess =
                timelapse.isPublished ||
                (ctx.user && ctx.user.id === timelapse.ownerId) ||
                (ctx.user && (ctx.user.permissionLevel === "ADMIN" || ctx.user.permissionLevel === "ROOT"));

            if (!canAccess) {
                return { ok: false, error: "Timelapse not found" };
            }

            return ok({ timelapse: dtoTimelapse(timelapse) });
        }),

    /**
     * Creates a pre-signed URL for uploading a timelapse video file to R2.
     */
    create: protectedProcedure
        .input(TimelapseMutableSchema)
        .output(
            apiResult({
                /**
                 * Pre-signed URL for uploading the video file
                 */
                uploadUrl: z.url(),

                /**
                 * The timelapse ID that will be used when confirming the upload
                 */
                timelapseId: z.uuid(),

                /**
                 * The key/path where the file will be stored in R2
                 */
                key: z.string(),
            })
        )
        .mutation(async ({ ctx }) => {
            const timelapseId = crypto.randomUUID();
            const key = `timelapses/${ctx.user.id}/${timelapseId}.mp4`;

            const command = new PutObjectCommand({
                Bucket: "lapse-encrypted",
                Key: key,
                ContentType: "video/mp4",
            });

            const uploadUrl = await getSignedUrl(s3, command, {
                expiresIn: 15 * 60, // 15 minutes
            });

            return ok({
                uploadUrl,
                timelapseId,
                key,
            });
        }),

    /**
     * Confirms the upload and creates the timelapse database entry.
     */
    confirmUpload: protectedProcedure
        .input(
            z.object({
                timelapseId: z.uuid(),
                key: z.string(),
                metadata: TimelapseMutableSchema,
            })
        )
        .output(
            apiResult({
                timelapse: TimelapseSchema,
            })
        )
        .mutation(async ({ ctx, input }) => {
            const videoUrl = `https://lapse-encrypted.${process.env.R2_ENDPOINT?.replace(
                "https://",
                ""
            )}/timelapses/${ctx.user.id}/${input.timelapseId}.mp4`;

            const timelapse = await db.timelapse.create({
                data: {
                    id: input.timelapseId,
                    ownerId: ctx.user.id,
                    name: input.metadata.name,
                    description: input.metadata.description,
                    privacy: input.metadata.privacy,
                    isPublished: false,
                    lengthSeconds: 0,
                    decryptedChecksum: input.metadata.decryptedChecksum,
                    videoUrl: videoUrl,
                },
            });

            return ok({ timelapse: dtoTimelapse(timelapse) });
        }),

    /**
     * Updates a timelapse.
     */
    update: protectedProcedure
        .input(
            z.object({
                id: z.uuid(),
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
        .mutation(async ({ ctx, input }) => {
            const timelapse = await db.timelapse.findFirst({
                where: { id: input.id },
            });

            if (!timelapse) {
                return { ok: false, error: "Timelapse not found" };
            }

            // Check permissions
            const canEdit =
                ctx.user.id === timelapse.ownerId ||
                ctx.user.permissionLevel === "ADMIN" ||
                ctx.user.permissionLevel === "ROOT";

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
            if (input.changes.name) updateData.name = input.changes.name;
            if (input.changes.description !== undefined)
                updateData.description = input.changes.description;
            if (input.changes.privacy) updateData.privacy = input.changes.privacy;

            const updatedTimelapse = await db.timelapse.update({
                where: { id: input.id },
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
        .mutation(async ({ ctx, input }) => {
            const timelapse = await db.timelapse.findFirst({
                where: { id: input.id },
            });

            if (!timelapse) {
                return { ok: false, error: "Timelapse not found" };
            }

            const canDelete =
                ctx.user.id === timelapse.ownerId ||
                ctx.user.permissionLevel === "ADMIN" ||
                ctx.user.permissionLevel === "ROOT";

            if (!canDelete) {
                return {
                    ok: false,
                    error: "You don't have permission to delete this timelapse",
                };
            }

            await db.timelapse.delete({
                where: { id: input.id },
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
                iv: z.hex().length(128 / 4),
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
        .mutation(async ({ ctx, input }) => {
            const timelapse = await db.timelapse.findFirst({
                where: { id: input.id },
            });

            if (!timelapse) {
                return { ok: false, error: "Timelapse not found" };
            }

            const canPublish =
                ctx.user.id === timelapse.ownerId ||
                ctx.user.permissionLevel === "ADMIN" ||
                ctx.user.permissionLevel === "ROOT";

            if (!canPublish) {
                return {
                    ok: false,
                    error: "You don't have permission to publish this timelapse",
                };
            }

            if (timelapse.isPublished) {
                return { ok: false, error: "Timelapse already published" };
            }

            // Extract encrypted file key from current video URL
            const encryptedKey = `timelapses/${ctx.user.id}/${input.id}.mp4`;
            const publicKey = `timelapses/${input.id}.mp4`;

            try {
                // Get encrypted video from lapse-encrypted bucket
                const getCommand = new GetObjectCommand({
                    Bucket: "lapse-encrypted",
                    Key: encryptedKey,
                });

                const encryptedObject = await s3.send(getCommand);
                const encryptedBuffer =
                    await encryptedObject.Body?.transformToByteArray();

                if (!encryptedBuffer) {
                    return { ok: false, error: "Failed to retrieve encrypted video" };
                }

                // Decrypt the video using AES-256-CBC
                const keyBuffer = Buffer.from(input.key, "hex");
                const ivBuffer = Buffer.from(input.iv, "hex");

                const decipher = crypto.createDecipheriv(
                    "aes-256-cbc",
                    keyBuffer,
                    ivBuffer
                );
                const decryptedBuffer = Buffer.concat([
                    decipher.update(Buffer.from(encryptedBuffer)),
                    decipher.final(),
                ]);

                // Upload decrypted video to lapse-public bucket
                const putCommand = new PutObjectCommand({
                    Bucket: "lapse-public",
                    Key: publicKey,
                    Body: decryptedBuffer,
                    ContentType: "video/mp4",
                });

                await s3.send(putCommand);

                // Delete from encrypted bucket
                const deleteCommand = new DeleteObjectCommand({
                    Bucket: "lapse-encrypted",
                    Key: encryptedKey,
                });

                await s3.send(deleteCommand);

                // Update database with new public URL
                const publicVideoUrl = `https://lapse-public.${process.env.R2_ENDPOINT?.replace(
                    "https://",
                    ""
                )}/timelapses/${input.id}.mp4`;

                const publishedTimelapse = await db.timelapse.update({
                    where: { id: input.id },
                    data: {
                        isPublished: true,
                        videoUrl: publicVideoUrl,
                        decryptedChecksum: `${input.key}:${input.iv}`,
                    },
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
        .query(async ({ ctx, input }) => {
            const isViewingSelf = ctx.user && ctx.user.id === input.user;
            const isAdmin =
                ctx.user &&
                (ctx.user.permissionLevel === "ADMIN" ||
                    ctx.user.permissionLevel === "ROOT");

            const whereClause: {
                ownerId: string;
                isPublished?: boolean;
                privacy?: "PUBLIC" | "UNLISTED";
            } = { ownerId: input.user };

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
