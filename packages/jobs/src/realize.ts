import { z } from "zod";
import { EditListEntrySchema } from "@hackclub/lapse-api";

/**
 * Represents the inputs for a `realize` job.
 */
export type RealizeJobInputs = z.infer<typeof RealizeJobInputsSchema>;
export const RealizeJobInputsSchema = z.object({
    /**
     * The ID of the target timelapse.
     */
    timelapseId: z.string(),

    /**
     * An array of public S3 URLs that point to the encrypted sessions that should compose the resulting timelapse.
     */
    sessionUrls: z.url().array(),

    /**
     * The passkey that will decrypt the target timelapse.
     */
    passkey: z.string(),

    /**
     * An array of edits to perform while encoding the video.
     */
    editList: EditListEntrySchema.array(),

    /**
     * The IV associated with the source draft timelapse.
     */
    iv: z.hex()
});

/**
 * Represents the outputs for a `realize` job.
 */
export type RealizeJobOutputs = z.infer<typeof RealizeJobOutputsSchema>;
export const RealizeJobOutputsSchema = z.object({
    /**
     * The timelapse that the `realize` job was running for.
     */
    timelapseId: z.string(),

    /**
     * The S3 key for the video, stored in the public S3 bucket, shared by both the server and the worker.
     */
    videoKey: z.string(),

    /**
     * The S3 key for the thumbnail, stored in the public S3 bucket, shared by both the server and the worker.
     */
    thumbnailKey: z.string(),

    /**
     * The duration of the compiled output video in seconds, as measured by ffprobe.
     * Optional for backwards compatibility with in-flight jobs that predate this field.
     */
    videoDuration: z.number().nonnegative().optional()
});

/**
 * Identifies the `realize` job queue within BullMQ.
 */
export const REALIZE_JOB_QUEUE_NAME = "lapse-realize";
