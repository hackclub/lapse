import { z } from "zod";
import { implement } from "@orpc/server";
import { S3Client } from "@aws-sdk/client-s3";
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { ascending, assert, chunked, closest, oneOf, when } from "@hackclub/lapse-shared";

import * as db from "@/generated/prisma/client.js";
import { containerTypeToExtension, containerTypeToMimeType, MAX_THUMBNAIL_UPLOAD_SIZE, MAX_VIDEO_UPLOAD_SIZE, mimeTypeToContainerType, TIMELAPSE_FRAME_LENGTH_MS, timelapseRouterContract, type OwnedTimelapse, type Timelapse } from "@hackclub/lapse-api";
import { logMiddleware, requiredAuth, type Context } from "@/router.js";
import { dtoKnownDevice, dtoPublicUser } from "@/routers/user.js";
import { env } from "@/env.js";
import { database } from "@/db.js";

import { apiOk, apiErr, type Result, Err } from "@/common.js";
import { actorEntitledTo, type Actor } from "@/ownership.js";
import { logError, logInfo } from "@/logging.js";
import { generateThumbnail } from "@/videoProcessing.js";
import { HackatimeOAuthApi, HackatimeUserApi, type WakaTimeHeartbeat } from "@/hackatime.js";
import { dtoComment, type DbComment } from "@/routers/comment.js";

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

const os = implement(timelapseRouterContract)
    .$context<Context>()
    .use(logMiddleware);

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

export default os.router({
    query: os.query
        .handler(async (req) => {
            const caller = req.context.user;

            const timelapse = await getTimelapseById(req.input.id, caller);
            if (timelapse instanceof Err)
                return timelapse.toApiError();

            return apiOk({ timelapse });
        }),

    createDraft: os.createDraft
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;
            
            const baseId = crypto.randomUUID();

            const video = await createUploadToken(database, {
                ownerId: caller.id,
                bucket: env.S3_ENCRYPTED_BUCKET_NAME,
                key: `timelapses/${caller.id}/${baseId}.${containerTypeToExtension(req.input.containerType)}`,
                mimeType: containerTypeToMimeType(req.input.containerType),
                maxSize: MAX_VIDEO_UPLOAD_SIZE,
            });

            const thumbnail = await createUploadToken(database, {
                ownerId: caller.id,
                bucket: env.S3_ENCRYPTED_BUCKET_NAME,
                key: `timelapses/${caller.id}/${baseId}-thumbnail.jpg`,
                mimeType: "image/jpeg",
                maxSize: MAX_THUMBNAIL_UPLOAD_SIZE,
            });

            const draft = await database.draftTimelapse.create({
                data: {
                    ownerId: caller.id,
                    videoTokenId: video.id,
                    thumbnailTokenId: thumbnail.id,
                }
            });

            return apiOk({ id: draft.id, videoToken: video.id, thumbnailToken: thumbnail.id });
        }),

    commit: os.commit
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            const draft = await database.draftTimelapse.findFirst({
                where: { id: req.input.id, ownerId: caller.id },
                include: { videoToken: true, thumbnailToken: true }
            });

            if (!draft)
                return apiErr("NOT_FOUND", `The draft timelapse ${req.input.id} couldn't be found.`);

            const videoUpload = draft.videoToken;
            const thumbnailUpload = draft.thumbnailToken;

            assert(videoUpload.ownerId == caller.id, "Video upload token wasn't owned by draft owner");
            assert(thumbnailUpload.ownerId == caller.id, "Thumbnail upload token wasn't owned by draft owner");

            if (!videoUpload.uploaded)
                return apiErr("NO_FILE", "The video hasn't yet been uploaded.");

            if (!thumbnailUpload.uploaded)
                return apiErr("NO_FILE", "The thumbnail hasn't yet been uploaded.");

            const device = await database.knownDevice.findFirst({
                where: { id: req.input.deviceId }
            });

            if (!device)
                return apiErr("DEVICE_NOT_FOUND", "The device creating this snapshot hasn't been registered with the server.");

            if (device.ownerId != caller.id)
                return apiErr("NO_PERMISSION", "The specified device doesn't belong to the logged in user.");

            const timelapse = await database.timelapse.create({
                include: TIMELAPSE_INCLUDES,
                data: {
                    id: draft.id,
                    createdAt: draft.createdAt,
                    ownerId: caller.id,
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

    update: os.update
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            const timelapse = await database.timelapse.findFirst({
                where: { id: req.input.id },
            });

            if (!timelapse)
                return apiErr("NOT_FOUND", "Couldn't find that timelapse!");

            const canEdit =
                caller.id === timelapse.ownerId ||
                caller.permissionLevel in oneOf("ADMIN", "ROOT");

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

    delete: os.delete
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            try {
                await deleteTimelapse(req.input.id, caller);
                return apiOk({});
            }
            catch (error) {
                logError("timelapse.delete", "Failed to delete timelapse!", { error });
                return apiErr("ERROR", "Failed to delete timelapse");
            }
        }),

    publish: os.publish
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            const timelapse = await database.timelapse.findFirst({
                where: { id: req.input.id },
            });

            if (!timelapse)
                return apiErr("NOT_FOUND", "Couldn't find that timelapse!");

            const canPublish =
                caller.id === timelapse.ownerId ||
                caller.permissionLevel in oneOf("ADMIN", "ROOT");

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

    findByUser: os.findByUser
        .handler(async (req) => {
            const caller = req.context.user;

            const isViewingSelf = caller && caller.id === req.input.user;
            const isAdmin = caller && (caller.permissionLevel in oneOf("ADMIN", "ROOT"));

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

            return apiOk({ timelapses: timelapses.map(x => dtoTimelapse(x, caller)) });
        }),

    syncWithHackatime: os.syncWithHackatime
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            const timelapse = await database.timelapse.findFirst({
                where: { id: req.input.id, ownerId: caller.id },
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
                where: { id: req.input.id, ownerId: caller.id },
                data: { hackatimeProject: req.input.hackatimeProject },
                include: TIMELAPSE_INCLUDES
            });

            return apiOk({ timelapse: dtoTimelapse(updatedTimelapse, caller) });
        })
});
