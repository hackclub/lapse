import { Queue, QueueEvents } from "bullmq";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { EditListEntry } from "@hackclub/lapse-api";
import { REALIZE_JOB_QUEUE_NAME, RealizeJobOutputsSchema, type RealizeJobInputs, type RealizeJobOutputs } from "@hackclub/lapse-jobs";

import { logError, logInfo, logWarning } from "@/logging.js";
import { database, redis } from "@/db.js";
import { env } from "@/env.js";
import { publicS3 } from "@/storage.js";
import { deleteDraftTimelapse } from "@/routers/draftTimelapse.js";
import { capSnapshotsToVideo, syncTimelapseWithHackatime } from "@/routers/timelapse.js";

// This file handles enqueuing jobs on the worker, as well as listening for completion/failed events.
// Callers are expected to queue jobs and disregard what happens after the completion (we handle that here!),
// but are encouraged to store job IDs in the entities that will be affected by the jobs.

type RealizeQueue = Pick<Queue<RealizeJobInputs, RealizeJobOutputs>, "add" | "remove" | "getJob">;

let _realizeQueue: RealizeQueue | null = null;

function realizeQueue() {
    _realizeQueue ??= new Queue<RealizeJobInputs, RealizeJobOutputs>(REALIZE_JOB_QUEUE_NAME, { connection: redis() });
    return _realizeQueue;
}

/**
 * Replaces the queue, so that publishing a legacy draft can be exercised without a worker.
 */
export function setRealizeQueueForTesting(queue: RealizeQueue) {
    _realizeQueue = queue;
}

/**
 * Enqueues a job in the worker to realize the video for a timelapse from encrypted sessions belonging to a (potentially removed) draft timelapse.
 * 
 * @param timelapseId The ID of the timelapse to assign the realized files to.
 * @param sessionUrls The S3 URLs to the encrypted sessions.
 * @param passkey The passkey used to encrypt the sessions.
 * @param iv The IV associated with the draft.
 * @param editList The edits to apply while encoding.
 */
export async function enqueueRealizeJob(timelapseId: string, sessionUrls: string[], passkey: string, iv: string, editList: EditListEntry[]) {
    return await realizeQueue().add(`realize-${timelapseId}`, {
        timelapseId,
        sessionUrls,
        passkey,
        iv,
        editList
    }, {
        attempts: 3,
        // The job carries the owner's device key. The completion handler only needs the event's return value, so
        // nothing should keep the key in Redis once the job is done; failed jobs are removed by the failure handler.
        removeOnComplete: true
    });
}

/**
 * Removes a realize job that hasn't started yet, along with the passkey it carries. A job that is already running
 * can't be removed; if its timelapse is gone by the time it finishes, the completion handler deletes what it uploaded.
 */
export async function cancelRealizeJob(jobId: string) {
    try {
        await realizeQueue().remove(jobId);
    }
    catch (err) {
        logWarning(`Could not remove realize job ${jobId}; it is probably running.`, { err });
    }
}

/**
 * Starts listening for realize jobs finishing or failing. Called once, when the server starts.
 */
export function startRealizeJobEvents() {
    const realizeEvents = new QueueEvents(REALIZE_JOB_QUEUE_NAME, { connection: redis() });

    realizeEvents.waitUntilReady()
        .then(() => {
            realizeEvents.on("completed", async ({ jobId, returnvalue }) => {
                const result = RealizeJobOutputsSchema.parse(typeof returnvalue === "object" ? returnvalue : JSON.parse(returnvalue));
                const { videoKey, thumbnailKey, timelapseId, realTimeDuration } = result;

                logInfo(`Timelapse ${timelapseId} finished processing! job=${jobId}`, { videoKey, thumbnailKey, realTimeDuration });

                // The timelapse was deleted while it was encoding (by its owner, or a privacy erasure), so nothing will
                // ever point at what the worker just uploaded.
                if (!await database().timelapse.findFirst({ where: { id: timelapseId }, select: { id: true } })) {
                    for (const key of [videoKey, thumbnailKey]) {
                        await publicS3.send(new DeleteObjectCommand({ Bucket: env.S3_PUBLIC_BUCKET_NAME, Key: key }));
                    }

                    logInfo(`Timelapse ${timelapseId} was deleted while processing; removed its realized files.`);
                    return;
                }

                const draft = await database().draftTimelapse.findFirst({
                    where: {
                        associatedTimelapseId: result.timelapseId
                    }
                });

                if (draft) {
                    // We're doing a complete delete of the draft timelapse - alongside the now consumed encrypted S3 objects.
                    const err = await deleteDraftTimelapse(draft.id, { kind: "SERVER" });
                    if (err) {
                        logWarning(`Could not delete draft timelapse ${draft.id} when publishing ${timelapseId}! ${err.message}`);
                    }
                }
                else {
                    logWarning(`No corresponding draft found for timelapse ${timelapseId}.`);
                }

                const currentTimelapse = await database().timelapse.findFirst({
                    where: { id: timelapseId },
                    include: { associatedDraft: true }
                });

                if (currentTimelapse?.sourceDraftId) {
                    await database().timelapse.deleteMany({
                        where: {
                            sourceDraftId: currentTimelapse.sourceDraftId,
                            visibility: "FAILED_PROCESSING",
                            id: { not: timelapseId }
                        }
                    });
                }

                // The snapshots become Hackatime heartbeats, so they can't claim much more time than the video holds.
                const snapshots = currentTimelapse && realTimeDuration != null
                    ? capSnapshotsToVideo(currentTimelapse.snapshots, realTimeDuration)
                    : null;

                if (snapshots && currentTimelapse && snapshots.length < currentTimelapse.snapshots.length)
                    logWarning(`Trimmed timelapse ${timelapseId} from ${currentTimelapse.snapshots.length} to ${snapshots.length} snapshots to match its ${realTimeDuration}s of video.`);

                // This basically marks the timelapse as having its processing finished (we assume any timelapse with an associated job ID is still being processed).
                const completedTimelapse = await database().timelapse.update({
                    where: {
                        id: timelapseId
                    },
                    data: {
                        associatedJobId: null,
                        s3Key: videoKey,
                        thumbnailS3Key: thumbnailKey,
                        ...(realTimeDuration != null && { duration: realTimeDuration }),
                        ...(snapshots && { snapshots })
                    },
                    include: { owner: true }
                });

                logInfo(`Successfully updated timelapse ${timelapseId} with transcoded data.`);

                if (completedTimelapse.hackatimeProject) {
                    try {
                        await syncTimelapseWithHackatime(completedTimelapse, completedTimelapse.owner);
                        logInfo(`Hackatime sync completed for timelapse ${timelapseId}, project ${completedTimelapse.hackatimeProject}.`);
                    }
                    catch (err) {
                        logError(`Hackatime sync failed for timelapse ${timelapseId}.`, { err });
                    }
                }
            });

            realizeEvents.on("failed", async ({ jobId, failedReason }) => {
                const job = await realizeQueue().getJob(jobId);
                if (!job) {
                    logError(`Non-existent realize job with ID ${jobId} failed: ${failedReason}`);
                    return;
                }

                logError(`Realize job for ${job.data.timelapseId} failed: ${failedReason}`);

                if (job.attemptsMade < (job.opts.attempts ?? 1))
                    return;

                // We keep the draft timelapse, mark the associated timelapse as failed processing, and unlink the two so that
                // the publishing of the draft can be retried by the user at a later time. Either may already be gone if the
                // timelapse was deleted while it was processing.
                await database().$transaction([
                    database().draftTimelapse.updateMany({
                        where: {
                            associatedTimelapseId: job.data.timelapseId
                        },
                        data: {
                            associatedTimelapseId: null
                        }
                    }),

                    database().timelapse.updateMany({
                        where: {
                            id: job.data.timelapseId
                        },
                        data: {
                            visibility: "FAILED_PROCESSING",
                            associatedJobId: null
                        }
                    })
                ]);

                // Retrying means publishing the draft again, which enqueues a new job - this one only holds the device key.
                try {
                    await job.remove();
                }
                catch (err) {
                    logWarning(`Could not remove failed realize job ${jobId}.`, { err });
                }
            });
        });
}
