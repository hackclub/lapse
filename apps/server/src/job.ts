import { Queue, type QueueOptions } from "bullmq";
import { Redis } from "ioredis";

import { REALIZE_JOB_QUEUE_NAME, type RealizeJobInputs, type RealizeJobOutputs } from "@hackclub/lapse-worker"

import { env } from "@/env.js";
import type { EditListEntry } from "@hackclub/lapse-api";

// Server <-> worker interfacing functions.

const redis = new Redis(env.REDIS_URL);

const realizeQueue = new Queue<RealizeJobInputs, RealizeJobOutputs>(REALIZE_JOB_QUEUE_NAME, { connection: redis });

/**
 * Enqueues a job in the worker to realize the video for a timelapse from encrypted sessions belonging to a (potentially removed) draft timelapse.
 * 
 * @param timelapseId The ID of the timelapse to assign the realized files to.
 * @param sessionUrls The S3 URLs to the encrypted sessions.
 * @param passkey The passkey used to encrypt the sessions.
 * @param editList The edits to apply while encoding.
 */
export async function enqueueRealizeJob(timelapseId: string, sessionUrls: string[], passkey: string, editList: EditListEntry[]) {
    return await realizeQueue.add(`realize-${timelapseId}`, {
        timelapseId,
        sessionUrls,
        passkey,
        editList
    }, {
        attempts: 3
    });
}
