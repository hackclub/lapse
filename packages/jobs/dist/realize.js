import { z } from "zod";
import { EditListEntrySchema } from "@hackclub/lapse-api";
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
    editList: EditListEntrySchema.array()
});
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
    thumbnailKey: z.string()
});
/**
 * Identifies the `realize` job queue within BullMQ.
 */
export const REALIZE_JOB_QUEUE_NAME = "lapse-realize";
//# sourceMappingURL=realize.js.map