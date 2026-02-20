import { z } from "zod";
import { Worker } from "bullmq";
import { EditListEntrySchema, TIMELAPSE_FPS } from "@hackclub/lapse-api";

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import { redis } from "@/redis.js";
import { decryptVideo } from "@/encrypted.js";
import { probeVideo, selectDominantResolution } from "@/video.js";

const execFileAsync = promisify(execFile);

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
    editList: EditListEntrySchema.array()
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
     * The resulting data or an error, depending on the state of the job.
     */
    result: z.discriminatedUnion("success", [
        z.object({
            /**
             * `true`; the job carried out successfully.
             */
            success: z.literal(true),

            /**
             * The S3 key for the video, stored in the public S3 bucket, shared by both the server and the worker.
             */
            videoKey: z.string()
        }),

        z.object({
            /**
             * `false`; processing has failed, and the associated timelapse entity's visibility should be set to `FAILED_PROCESSING`.
             */
            success: z.literal(false),

            /**
             * An internal error message that should be passed to the server log.
             */
            error: z.string()
        })
    ])
});

/**
 * Identifies the `realize` job queue within BullMQ.
 */
export const REALIZE_JOB_QUEUE_NAME = "lapse-realize";

export const realizeJobWorker = new Worker<RealizeJobInputs, RealizeJobOutputs>(
    REALIZE_JOB_QUEUE_NAME,
    async (job) => {
        const input = RealizeJobInputsSchema.parse(job.data);
        const timelapseId = input.timelapseId;

        const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "lapse-"));

        const sessions: string[] = [];
        for (const [i, sessionUrl] of input.sessionUrls.entries()) {
            let encryptedBuffer: Buffer;

            try {
                const res = await fetch(sessionUrl);
                encryptedBuffer = Buffer.from(await res.arrayBuffer());
            }
            catch (err) {
                return { timelapseId, result: { error: `Could not retrieve session ${sessionUrl}; ${err instanceof Error ? err.message : err}` } };
            }

            let decryptedBuffer: Buffer;

            try {
                decryptedBuffer = decryptVideo(encryptedBuffer, timelapseId, input.passkey);
            }
            catch (err) {
                return { timelapseId, result: { error: `Could not decrypt session ${sessionUrl}; ${err instanceof Error ? err.message : err}` } };
            }

            const sessionPath = path.join(tmp, `session-${i}.webm`); // assuming webm here - but ffmpeg should be able to figure that out from the file headers
            await fsp.writeFile(sessionPath, decryptedBuffer);

            sessions.push(sessionPath);
        }

        // Won't be needing this anymore!
        input.passkey = "<REDACTED>";
        job.data.passkey = "<REDACTED>";

        // Now that we have all of the sessions, we can proceed with combining them into one video file. All uploaded timelapses are required to be in real-time,
        // so we need to speed them up here.

        const sessionProbes = await Promise.all(sessions.map(x => probeVideo(x)));
        const resolution = selectDominantResolution(sessionProbes);

        const args: string[] = [];

        for (const session of sessions) {
            args.push("-fflags", "+discardcorrupt"); // discard corrupted packets (as opposed to failing)
            args.push("-err_detect", "ignore_err"); // ignore errors and continue decoding
            args.push("-i", session);
        }

        // These normalize all sessions to the same resolution, FPS, and color space.
        const normalizeFilters = sessions
            .map((_, i) => (
                `[${i}:v]` + // input i, access video stream
                `scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,` +
                `pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2,` +
                `fps=${TIMELAPSE_FPS},format=yuv420p[v${i}]` // output goes to "v${i}"
            ))
            .join(";");

        // These two are responsible for actually combining the sessions.
        const concatInputs = sessions.map((_, i) => `[v${i}]`).join("");
        const concatFilters = `${concatInputs}concat=n=${sessions.length}:v=1:a=0[vcat]`; // output goes to "vcat"

        // This removes the regions of frames that the edit list specifies to remove.
        const cuts = input.editList
            .filter(x => x.kind === "CUT")
            .map(x => `between(t\\,${x.begin / TIMELAPSE_FPS}\\,${x.end / TIMELAPSE_FPS})`)
            .join("+");

        await execFileAsync("ffmpeg", [
            
        ]);

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

        return { timelapseId: "", videoKey: "" }
    },
    { connection: redis }
);