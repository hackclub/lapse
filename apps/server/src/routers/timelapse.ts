import { z } from "zod";
import { implement } from "@orpc/server";
import { HeadObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { oneOf } from "@hackclub/lapse-shared";
import { EditListEntrySchema, timelapseRouterContract, type OwnedTimelapse, type Timelapse } from "@hackclub/lapse-api";

import * as db from "@/generated/prisma/client.js";
import { logMiddleware, requiredAuth, type Context } from "@/router.js";
import { dtoPublicUser } from "@/routers/user.js";
import { env } from "@/env.js";
import { database } from "@/db.js";
import { apiOk, apiErr, type Result, Err, lapseId } from "@/common.js";
import { actorEntitledTo, type Actor } from "@/ownership.js";
import { logError, logInfo, logWarning } from "@/logging.js";
import { HackatimeOAuthApi, HackatimeUserApi, type WakaTimeHeartbeat } from "@/hackatime.js";
import { dtoComment, type DbComment } from "@/routers/comment.js";
import { enqueueRealizeJob } from "@/job.js";

const s3 = new S3Client({
    region: "auto",
    endpoint: env.S3_ENDPOINT,
    credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
});

export type DbTimelapse = db.Timelapse & { owner: db.User, comments: DbComment[] };
export type DbOwnedTimelapse = DbTimelapse & { owner: db.User };

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
        playbackUrl: entity.s3Key == null ? null : `${env.S3_PUBLIC_URL_PUBLIC}/${entity.s3Key}`,
        thumbnailUrl: entity.thumbnailS3Key == null ? null : `${env.S3_PUBLIC_URL_PUBLIC}/${entity.thumbnailS3Key}`,
        duration: entity.duration,
        isDraft: false
    };
}

/**
 * Converts a database representation of a timelapse to a runtime (API) one, including all private fields.
 */
export function dtoOwnedTimelapse(entity: DbOwnedTimelapse): OwnedTimelapse {
    return {
        ...dtoPublicTimelapse(entity),
        isDraft: false,
        private: {
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

    return dtoPublicTimelapse(entity);
}

/**
 * Permanently deletes a timelapse, including all its snapshots and S3 files.
 */
export async function deleteTimelapse(timelapseId: string, actor: Actor): Promise<Result<void>> {
    const timelapse = await database().timelapse.findFirst({
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

    // Scary stuff ahead! If we mess this up, we permanently lose data. We don't want that!
    if (timelapse.s3Key) {
        await s3.send(new DeleteObjectCommand({
            Bucket: env.S3_PUBLIC_URL_PUBLIC,
            Key: timelapse.s3Key
        }));
    }

    if (timelapse.thumbnailS3Key) {
        await s3.send(new DeleteObjectCommand({
            Bucket: env.S3_PUBLIC_URL_PUBLIC,
            Key: timelapse.thumbnailS3Key
        }));
    }

    await database().timelapse.delete({
        where: { id: timelapse.id }
    });

    logInfo(`Timelapse ${timelapseId} (${timelapse.name}) deleted.`, { timelapse });
}


/**
 * Finds a timelapse by its ID.
 */
export async function getTimelapseById(id: string, actor: Actor): Promise<Result<Timelapse | OwnedTimelapse>> {
    const timelapse = await database().timelapse.findFirst({
        where: { id },
        include: TIMELAPSE_INCLUDES
    });

    if (!timelapse)
        return new Err("NOT_FOUND", "Couldn't find that timelapse!");

    // Only owners and/or administrators can view timelapses that have failed processing OR are still being processed.
    if (
        !actorEntitledTo(timelapse, actor) && (
            timelapse.visibility === "FAILED_PROCESSING" ||
            timelapse.associatedJobId != null
        )
    ) {
        return new Err("NOT_FOUND", "Couldn't find that timelapse!");
    }

    return dtoTimelapse(timelapse, actor);
}

/**
 * Computes the length of a timelapse by its snapshots. A snapshot is a timestamp of when a video frame was captured.
 */
export function durationBySnapshots(snapshots: Date[]): number {
    const TOLERANCE = 2 * 60 * 1000; // spans in two adjacent snapshots that are larger than this are ignored and not summed

    if (snapshots.length <= 1)
        return 0;

    let totalDuration = 0;
    for (let i = 1; i < snapshots.length; i++) {
        const span = snapshots[i].getTime() - snapshots[i - 1].getTime();
        if (span <= TOLERANCE) {
            totalDuration += span;
        }
    }

    return totalDuration / 1000;
}

/**
 * Specify this for `include` when querying `Timelapse` entities in order to retrieve the data required for a `DbOwnedTimelapse`.
 */
export const TIMELAPSE_INCLUDES = {
    owner: true,
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

    publish: os.publish
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            const draft = await database().draftTimelapse.findFirst({
                where: {
                    id: req.input.id,
                    ownerId: caller.id
                }
            });

            if (!draft)
                return apiErr("NOT_FOUND", `The draft timelapse ${req.input.id} couldn't be found.`);

            // There _is_ a scenario where the caller just ignores our S3 upload URLs and never uploads the sessions they promised to upload.
            let allUploaded = true;

            for (const session of draft.sessions) {
                try {
                    await s3.send(
                        new HeadObjectCommand({
                            Bucket: env.S3_ENCRYPTED_BUCKET_NAME,
                            Key: session
                        })
                    );
                }
                catch (error) {
                    logWarning(`User tried to publish a draft timelapse, but session ${session} cannot be accessed!`, { error });
                    allUploaded = false;
                    break;
                }
            }

            if (!allUploaded)
                return apiErr("ERROR", "A session of the given draft timelapse hasn't been uploaded or otherwise cannot be accessed.");

            const id = lapseId();

            // We purposefully omit `s3Key` and `s3ThumbnailKey` here.
            const timelapse = await database().timelapse.create({
                include: TIMELAPSE_INCLUDES,
                data: {
                    id,
                    createdAt: draft.createdAt,
                    ownerId: caller.id,
                    name: draft.name ?? `Timelapse at ${draft.createdAt.toLocaleString("en-US", { month: "long", day: "numeric", minute: "numeric", hour: "numeric" })}`,
                    description: draft.description,
                    visibility: req.input.visibility,
                    snapshots: draft.snapshots,
                    duration: durationBySnapshots(draft.snapshots)
                }
            });

            // We associate the newly created Timelapse entity with the draft. When a draft has an associated timelapse, that means it is currently being processed, and thus will be hidden
            // from any API queries.
            await database().draftTimelapse.update({
                where: { id: draft.id },
                data: {
                    associatedTimelapseId: id
                }
            });

            // After this job finishes, we'll get a callback on the server-side. When that happens, we'll assign the ready video to the timelapse we just created, and mark it as processed!
            const realizeJob = await enqueueRealizeJob(
                id,
                draft.sessions.map(x => `${env.S3_PUBLIC_URL_ENCRYPTED}/${x}`),
                req.input.passkey,
                draft.editList.map(x => EditListEntrySchema.parse(x))
            );

            if (!realizeJob.id) {
                logWarning("We enqueued a realize job, but it does not have an ID! Something went very wrong!", { realizeJob });
            }

            // Update the timelapse with the job ID
            const updatedTimelapse = await database().timelapse.update({
                include: TIMELAPSE_INCLUDES,
                where: { id },
                data: {
                    associatedJobId: realizeJob.id
                }
            });

            return apiOk({ timelapse: dtoOwnedTimelapse(updatedTimelapse) });
        }),

    update: os.update
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            const timelapse = await database().timelapse.findFirst({
                where: { id: req.input.id }
            });

            if (!timelapse)
                return apiErr("NOT_FOUND", "Couldn't find that timelapse!");

            const canEdit =
                caller.id === timelapse.ownerId ||
                caller.permissionLevel in oneOf("ADMIN", "ROOT");

            if (!canEdit)
                return apiErr("NOT_FOUND", "You don't have permission to edit this timelapse");

            if (timelapse.visibility === "FAILED_PROCESSING")
                return apiErr("ERROR", "You can only delete timelapses that failed processing");

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

            const updatedTimelapse = await database().timelapse.update({
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

            const res = await deleteTimelapse(req.input.id, caller);
            if (res instanceof Err)
                return res.toApiError();

            return apiOk({});
        }),

    findByUser: os.findByUser
        .handler(async (req) => {
            const caller = req.context.user;

            const isEntitled = (
                (caller && caller.id === req.input.user) || // viewing self
                (caller && (caller.permissionLevel in oneOf("ADMIN", "ROOT"))) // caller is admin
            );

            const timelapses = await database().timelapse.findMany({
                include: TIMELAPSE_INCLUDES,
                orderBy: { createdAt: "desc" },
                where: {
                    ownerId: req.input.user,
                    visibility: isEntitled ? undefined : "PUBLIC", // if user is not entitled to view all timelapses, only show PUBLIC ones
                    associatedJobId: isEntitled ? undefined : null // same as above. only show timelapses that aren't processing to the public
                }
            });

            return apiOk({ timelapses: timelapses.map(x => dtoTimelapse(x, caller)) });
        }),

    syncWithHackatime: os.syncWithHackatime
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            const timelapse = await database().timelapse.findFirst({
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

            if (process.env["NODE_ENV"] !== "production" && env.DEV_HACKATIME_FALLBACK_KEY) {
                userApiKey = env.DEV_HACKATIME_FALLBACK_KEY;
            }
            else {
                const oauthApi = new HackatimeOAuthApi(timelapse.owner.hackatimeAccessToken);
                userApiKey = await oauthApi.apiKey();
            }

            if (!userApiKey)
                return apiErr("ERROR", "You don't have a Hackatime account! Create one at https://hackatime.hackclub.com.");

            const hackatime = new HackatimeUserApi(userApiKey);

            const heartbeats: WakaTimeHeartbeat[] = timelapse.snapshots.map(x => ({
                entity: `${timelapse.name} (${timelapse.id})`,
                time: x.getTime() / 1000,
                category: "timelapsing",
                type: "timelapse",
                user_agent: "wakatime/lapse (lapse) lapse/2.0.0 lapse/2.0.0",
                project: req.input.hackatimeProject
            }));

            const assignedHeartbeats = await hackatime.pushHeartbeats(heartbeats);
            const failedHeartbeat = assignedHeartbeats.responses.find(x => x[1] < 200 || x[1] > 299);
            if (failedHeartbeat) {
                logError("Couldn't sync heartbeat!", { failedHeartbeat, heartbeats, snapshots: timelapse.snapshots });
                return apiErr("HACKATIME_ERROR", `Hackatime returned HTTP ${failedHeartbeat[1]} for heartbeat at ${failedHeartbeat[0]?.time}! Report this at https://github.com/hackclub/lapse.`);
            }

            logInfo(`All heartbeats synchronized with snapshots for ${timelapse.owner.handle}'s project ${req.input.hackatimeProject}!`);

            const updatedTimelapse = await database().timelapse.update({
                where: { id: req.input.id, ownerId: caller.id },
                data: { hackatimeProject: req.input.hackatimeProject },
                include: TIMELAPSE_INCLUDES
            });

            return apiOk({ timelapse: dtoTimelapse(updatedTimelapse, caller) });
        })
});
