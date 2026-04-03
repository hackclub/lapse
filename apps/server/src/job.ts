import { Queue, QueueEvents } from "bullmq";
import type { EditListEntry } from "@hackclub/lapse-api";
import { REALIZE_JOB_QUEUE_NAME, RealizeJobOutputsSchema, type RealizeJobInputs, type RealizeJobOutputs } from "@hackclub/lapse-jobs";

import { logError, logInfo, logWarning } from "@/logging.js";
import { database, redis } from "@/db.js";
import { deleteDraftTimelapse } from "@/routers/draftTimelapse.js";
import { syncTimelapseWithHackatime } from "@/routers/timelapse.js";

// This file handles enqueuing jobs on the worker, as well as listening for completion/failed events.
// Callers are expected to queue jobs and disregard what happens after the completion (we handle that here!),
// but are encouraged to store job IDs in the entities that will be affected by the jobs.

const realizeQueue = new Queue<RealizeJobInputs, RealizeJobOutputs>(REALIZE_JOB_QUEUE_NAME, { connection: redis() });
const realizeEvents = new QueueEvents(REALIZE_JOB_QUEUE_NAME, { connection: redis() });

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
    return await realizeQueue.add(`realize-${timelapseId}`, {
        timelapseId,
        sessionUrls,
        passkey,
        iv,
        editList
    }, {
        attempts: 3
    });
}

realizeEvents.waitUntilReady()
    .then(() => {
        realizeEvents.on("completed", async ({ jobId, returnvalue }) => {
            const result = RealizeJobOutputsSchema.parse(typeof returnvalue === "object" ? returnvalue : JSON.parse(returnvalue));
            const { videoKey, thumbnailKey, timelapseId, realTimeDuration } = result;

            logInfo(`Timelapse ${timelapseId} finished processing! job=${jobId}`, { videoKey, thumbnailKey, realTimeDuration });

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

            // This basically marks the timelapse as having its processing finished (we assume any timelapse with an associated job ID is still being processed).
            const completedTimelapse = await database().timelapse.update({
                where: {
                    id: timelapseId
                },
                data: {
                    associatedJobId: null,
                    s3Key: videoKey,
                    thumbnailS3Key: thumbnailKey,
                    ...(realTimeDuration != null && { duration: realTimeDuration })
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
            const job = await realizeQueue.getJob(jobId);
            if (!job) {
                logError(`Non-existent realize job with ID ${jobId} failed: ${failedReason}`);
                return;
            }

            logError(`Realize job for ${job.data.timelapseId} failed: ${failedReason}`);

            if (job.attemptsMade < (job.opts.attempts ?? 1))
                return;

            // We keep the draft timelapse, mark the associated timelapse as failed processing, and unlink the two so that
            // the publishing of the draft can be retried by the user at a later time.
            await database().$transaction([
                database().draftTimelapse.update({
                    where: {
                        associatedTimelapseId: job.data.timelapseId
                    },
                    data: {
                        associatedTimelapseId: null
                    }
                }),

                database().timelapse.update({
                    where: {
                        id: job.data.timelapseId
                    },
                    data: {
                        visibility: "FAILED_PROCESSING",
                        associatedJobId: null
                    }
                })
            ]);
        });
    });