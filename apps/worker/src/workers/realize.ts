import { z } from "zod";
import { Worker } from "bullmq";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { EditListEntrySchema, THUMBNAIL_SIZE, TIMELAPSE_FACTOR, TIMELAPSE_FPS, type EditListEntry } from "@hackclub/lapse-api";

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";

import { redis } from "@/redis.js";
import { decryptVideo } from "@/encrypted.js";
import { measureVideoDuration, probeVideo, selectDominantResolution } from "@/video.js";
import { env } from "@/env.js";
import { JobLogger } from "@/log.js";

const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${env.S3_ENDPOINT}`,
    credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
});

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

/**
 * Equivalent to `execFile`, but also logs everything through the given `JobLogger` and returns an `Error` if the invocation failed.
 */
async function execAndLog(log: JobLogger, name: string, args: string[]) {
    log.info(`invoking: ${name} ${args.join(" ")}`);

    return await new Promise<void>((resolve, reject) => {
        execFile(name, args, (error, stdout, stderr) => {
            log.error("stdout:");
            for (const line of stdout.split("\n")) {
                log.error(`  ${line}`);
            }

            log.error("stderr:");
            for (const line of stderr.split("\n")) {
                log.error(`  ${line}`);
            }

            if (error) {
                log.error(`${name} failed! ${error.message}, code=${error.code}, errno=${error.errno}`);
                reject(error);
                return;
            }

            log.info(`${name} exited successfully!`);
            resolve();
        });
    });
}

export const realizeJobWorker = new Worker<RealizeJobInputs, RealizeJobOutputs>(
    REALIZE_JOB_QUEUE_NAME,
    async (job) => {
        const log = new JobLogger(job.name, job.id!);

        const input = RealizeJobInputsSchema.parse(job.data);
        const timelapseId = input.timelapseId;

        log.info(`realize job started for ${input.timelapseId} with ${input.sessionUrls.length} sessions, edit list = ${input.editList.length}`);

        const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "lapse-"));

        const sessions: string[] = [];
        for (const [i, sessionUrl] of input.sessionUrls.entries()) {
            let encryptedBuffer: Buffer;

            try {
                const res = await fetch(sessionUrl);
                encryptedBuffer = Buffer.from(await res.arrayBuffer());
            }
            catch (err) {
                throw log.echo(
                    new Error(`Could not retrieve session ${sessionUrl}; ${err instanceof Error ? err.message : err}`, { cause: err })
                );
            }

            let decryptedBuffer: Buffer;

            try {
                decryptedBuffer = decryptVideo(encryptedBuffer, timelapseId, input.passkey);
            }
            catch (err) {
                throw log.echo(
                    new Error(`Could not decrypt session ${sessionUrl}; ${err instanceof Error ? err.message : err}`, { cause: err })
                );
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

        log.info(`all sessions probed; dominant resolution is ${resolution.width}x${resolution.height}`);

        // These normalize all sessions to the same resolution, FPS, and color space.
        const normalizeFilters = sessions
            .map((_, i) => (
                `[${i}:v]` + // input i, access video stream
                `scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=increase,` +
                `pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2,` +
                `fps=${TIMELAPSE_FPS},format=yuv420p[v${i}]` // output goes to "v${i}"
            ))
            .join(";");

        // These two are responsible for actually combining the sessions.
        const concatInputs = sessions.map((_, i) => `[v${i}]`).join("");
        const concatFilters = `${concatInputs}concat=n=${sessions.length}:v=1:a=0[vcat]`; // output goes to "vcat"

        // For cuts, we want to normalize our regions so that none overlap, and are all valid.
        const cutList = (() => {
            const normalized = input.editList
                .filter(x => x.kind === "CUT")
                .filter(x => Number.isFinite(x.begin) && Number.isFinite(x.end))
                .filter(x => x.end > x.begin)
                .map(x => ({
                    // Make sure we don't end up with any fractional frames
                    begin: Math.floor(x.begin),
                    end: Math.floor(x.end),
                    kind: x.kind
                }));

            // We sort all regions, so that we begin with the earliest ones first. If two regions have the same begin point, we
            // use the end point as the tiebreaker.
            normalized.sort((a, b) => (a.begin !== b.begin) ? a.begin - b.begin : a.end - b.end);

            const merged: EditListEntry[] = [];
            let current = { ...normalized[0] };

            for (let i = 1; i < normalized.length; i++) {
                const next = normalized[i];

                if (next.begin <= current.end) {
                    // The region we're iterating over is overlapping *or* adjacent to the current one, meaning it's "inside" the previous one.
                    // Accumulate the end to the current region IF it's beyond said region.
                    current.end = Math.max(current.end, next.end);
                }
                else {
                    // This region doesn't touch the previous one, all is good.
                    merged.push(current);
                    current = { ...next };
                }
            }

            // We still have our last region to push!
            merged.push(current);

            return merged;
        })();

        log.info(`normalized cut list: ${cutList.map(x => `${x.begin} -> ${x.end}`).join(", ")}`);

        // This removes the regions of frames that the edit list specifies to remove.
        const cuts = cutList
            .map(x => `between(t\\,${x.begin / TIMELAPSE_FPS}\\,${x.end / TIMELAPSE_FPS})`)
            .join("+");

        const editAndSpeedFilter = cuts.length > 0
            ? `[vcat]select='not(${cuts})',setpts=PTS/${TIMELAPSE_FACTOR}[vout]`
            : `[vcat]setpts=PTS/${TIMELAPSE_FACTOR}[vout]`;

        const outputPath = path.join(tmp, "video.mp4");
        const thumbOutputPath = path.join(tmp, "thumbnail.avif");

        await execAndLog(log, "ffmpeg", [
            // input definitions
            ...sessions.flatMap(x => [
                "-fflags", "+discardcorrupt", // discard corrupted packets (as opposed to failing)
                "-err_detect", "ignore_err", // ignore errors and continue decoding
                "-i", x
            ]),

            // filter graph
            "-filter_complex", `${normalizeFilters};${concatFilters};${editAndSpeedFilter}`,
            "-map", "[vout]", // note: our final video output must be written to [vout] in the last filter_complex!

            // encoding settings
            "-c:v", "libx264",
            "-preset", "medium", // (this might need tweaking depending on benchmarks)
            "-crf", "24",
            "-profile:v", "high",
            "-pixfmt", "yuv420p", // 4:2:0 chroma subsampling, this might be the default, but we set it just in case. yuvj420p would be best but might have incompatibilities
            "-movflags", "+faststart",

            "-an", // make sure no audio creeps its way through
            "-y", // if ffmpeg asks, say yes

            outputPath
        ]);

        // Thumbnail generation - we opt for a simple approach where we just get the frame in the middle of the video.
        const thumbnailTimestamp = (await measureVideoDuration(outputPath)) / 2;

        // Arguments to generate thumbnails regardless of output format
        let thumbnailContentType = "image/avif";
        const baseThumbnailArgs = [
            "-ss", thumbnailTimestamp.toString(), // this is *before* our input file, and thus will be a faster (but inaccurate) seek
            "-i", outputPath,
            "-frames:v", "1",
            "-map", "0:v:0",
            "-vf", `scale=${THUMBNAIL_SIZE}:-1`, // resize
            "-y"
        ];

        try {
            await execAndLog(log, "ffmpeg", [
                ...baseThumbnailArgs,
                "-c:v", "libaom-av1", // we use AVIF for our thumbnails as it's Baseline 2024
                "-still-picture", "1",
                "-crf", "35", // higher = smaller file
                "-b:v", "0", // required for CRF-only mode
                "-cpu-used", "4", // effort to put into the encode, lower = higher quality but slower
                "-row-mt", "1",
                "-pix_fmt", "yuv420p",
                thumbOutputPath
            ]);
        }
        catch (err) {
            // Hm. Something went wrong when generating our thumbnail. Try JPEG.
            log.warn("could not generate AVIF thumbnail; trying JPEG");

            thumbnailContentType = "image/jpeg";

            try {
                await execAndLog(log, "ffmpeg", [
                    ...baseThumbnailArgs,
                    "-c:v", "mjpeg",
                    "-q:v", "5",
                    "-pix_fmt", "yuvj420p",
                    thumbOutputPath
                ]);
            }
            catch (err) {
                // Well... we can't really proceed without a thumbnail.
                throw log.echo(
                    new Error(`Could not generate thumbnail. ${err}`, { cause: err })
                );
            }

            log.info("JPEG fallback for thumbnail was successful!");
        }

        const videoKey = `timelapses/${timelapseId}/timelapse-${timelapseId}.mp4`;
        const thumbnailKey = `timelapses/${timelapseId}/thumbnail-${timelapseId}.avif`;

        const outputStream = fs.createReadStream(outputPath);
        const thumbnailStream = fs.createReadStream(thumbOutputPath);

        try {
            await new Upload({
                client: s3,
                params: {
                    Bucket: env.S3_PUBLIC_BUCKET_NAME,
                    Key: videoKey,
                    ContentType: "video/mp4",
                    Body: outputStream
                }
            }).done();
        }
        catch (err) {
            throw log.echo(
                new Error(`S3 video upload failed. ${err}`, { cause: err })
            );
        }

        try {
            await new Upload({
                client: s3,
                params: {
                    Bucket: env.S3_PUBLIC_BUCKET_NAME,
                    Key: thumbnailKey,
                    ContentType: thumbnailContentType, // we don't hard-code this because of our JPEG fallback
                    Body: thumbnailStream
                }
            }).done();
        }
        catch (err) {
            throw log.echo(
                new Error(`S3 thumbnail upload failed. ${err}`, { cause: err })
            );
        }
        
        try {
            // Video and thumbnail uploaded to S3 - dispose of all resources.
            outputStream.close();
            thumbnailStream.close();

            await fsp.unlink(outputPath);
            await fsp.unlink(thumbOutputPath);
        }
        catch (err) {
            // Not ideal, but we can continue.
            log.warn(`could not dispose of video/thumbnail; ${err}`);
        }

        // Yay - we're done! The ready video and timelapse have been uploaded to the right S3 buckets. The server should
        // be notified of our ready job afterwards.
        return {
            timelapseId,
            videoKey,
            thumbnailKey
        };
    },
    { connection: redis }
);