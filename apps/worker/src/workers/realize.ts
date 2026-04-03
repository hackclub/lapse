import { Worker } from "bullmq";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { THUMBNAIL_SIZE, TIMELAPSE_FACTOR, TIMELAPSE_FPS, type EditListEntry } from "@hackclub/lapse-api";
import { REALIZE_JOB_QUEUE_NAME, RealizeJobInputsSchema, type RealizeJobInputs, type RealizeJobOutputs } from "@hackclub/lapse-jobs";
import { decryptData, fromHex } from "@hackclub/lapse-shared";

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";

import { redis } from "@/redis.js";
import { measureVideoDuration, probeVideo, selectDominantResolution } from "@/video.js";
import { env } from "@/env.js";
import { JobLogger } from "@/log.js";

const s3 = new S3Client({
    region: "auto",
    endpoint: env.S3_ENDPOINT,
    credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
});

/**
 * Flags that should be included at the beginning of each `ffmpeg` invocation.
 */
const COMMON_FFMPEG_FLAGS = [
    "-hide_banner",
    "-nostats"
];

/**
 * Equivalent to `execFile`, but also logs everything through the given `JobLogger` and returns an `Error` if the invocation failed.
 */
async function execAndLog(log: JobLogger, name: string, args: string[]) {
    log.info(`invoking: ${name} ${args.join(" ")}`);

    return await new Promise<void>((resolve, reject) => {
        execFile(name, args, (error, stdout, stderr) => {
            log.info("stdout:");
            for (const line of stdout.split("\n")) {
                log.info(`  ${line}`);
            }

            log.info("stderr:");
            for (const line of stderr.split("\n")) {
                log.info(`  ${line}`);
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
        let outputStream: fs.ReadStream | null = null;
        let thumbnailStream: fs.ReadStream | null = null;

        try {
            const sessions: string[] = [];
            for (const [i, sessionUrl] of input.sessionUrls.entries()) {
                let encryptedBuffer: ArrayBuffer;

                try {
                    const res = await fetch(sessionUrl);
                    encryptedBuffer = await res.arrayBuffer();
                }
                catch (err) {
                    throw log.echo(
                        new Error(`Could not retrieve session ${sessionUrl}; ${err instanceof Error ? err.message : err}`, { cause: err })
                    );
                }

                if (encryptedBuffer.byteLength <= 8) {
                    log.info(`skipping impossibly small session ${sessionUrl} (${encryptedBuffer.byteLength} bytes)`);
                    continue;
                }

                let decryptedBuffer: ArrayBuffer;

                try {
                    decryptedBuffer = await decryptData(
                        fromHex(input.passkey).buffer,
                        fromHex(input.iv).buffer,
                        encryptedBuffer
                    );
                }
                catch (err) {
                    throw log.echo(
                        new Error(`Could not decrypt session ${sessionUrl}; ${err instanceof Error ? err.message : err}`, { cause: err })
                    );
                }

                if (decryptedBuffer.byteLength <= 8) {
                    log.info(`skipping impossibly small session ${sessionUrl} (${encryptedBuffer.byteLength} bytes)`);
                    continue;
                }

                const sessionPath = path.join(tmp, `session-${i}.webm`); // assuming webm here - but ffmpeg should be able to figure that out from the file headers
                await fsp.writeFile(sessionPath, Buffer.from(decryptedBuffer));

                sessions.push(sessionPath);
            }

            if (sessions.length === 0) {
                throw log.echo(
                    new Error("No valid sessions were retrieved or decrypted; aborting realization.")
                );
            }

            // Won't be needing this anymore!
            input.passkey = "<REDACTED>";
            job.data.passkey = "<REDACTED>";

            // Now that we have all of the sessions, we can proceed with combining them into one video file. All uploaded timelapses are required to be in real-time,
            // so we need to speed them up here.

            const sessionProbes = await Promise.all(sessions.map(x => probeVideo(x, log)));
            const resolution = selectDominantResolution(sessionProbes);

            log.info(`all sessions probed; dominant resolution is ${resolution.width}x${resolution.height}`);

            // Ensure dimensions are even — ffmpeg's scale with force_original_aspect_ratio rounds
            // output to even numbers, which can exceed odd pad dimensions and cause failures.
            const padWidth = resolution.width + (resolution.width % 2);
            const padHeight = resolution.height + (resolution.height % 2);

            // These normalize all sessions to the same resolution, FPS, and color space.
            const normalizeFilters = sessions
                .map((_, i) => (
                    `[${i}:v]` + // input i, access video stream
                    `scale=${padWidth}:${padHeight}:force_original_aspect_ratio=decrease,` +
                    `pad=${padWidth}:${padHeight}:(ow-iw)/2:(oh-ih)/2,` +
                    `fps=${TIMELAPSE_FPS},format=yuv420p,setsar=1[v${i}]` // output goes to "v${i}"
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
                        begin: Math.floor(x.begin * 1000) / 1000,
                        end: Math.ceil(x.end * 1000) / 1000,
                        kind: x.kind
                    }));

                if (normalized.length === 0)
                    return [];

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
                .map(x => `between(t\\,${x.begin}\\,${x.end})`)
                .join("+");

            const editAndSpeedFilter = cuts.length > 0
                ? `[vcat]select='not(${cuts})',setpts=N/FRAME_RATE/${TIMELAPSE_FACTOR}/TB[vout]`
                : `[vcat]setpts=PTS/${TIMELAPSE_FACTOR}[vout]`;

            const outputPath = path.join(tmp, "video.mp4");
            const thumbOutputPath = path.join(tmp, "thumbnail.avif");

            await execAndLog(log, "ffmpeg", [
                ...COMMON_FFMPEG_FLAGS,

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
                "-pix_fmt", "yuv420p", // 4:2:0 chroma subsampling, this might be the default, but we set it just in case. yuvj420p would be best but might have incompatibilities
                "-movflags", "+faststart",

                "-an", // make sure no audio creeps its way through
                "-y", // if ffmpeg asks, say yes

                outputPath
            ]);

            // Thumbnail generation - we opt for a simple approach where we just get the frame in the middle of the video.
            const videoDuration = await measureVideoDuration(outputPath);
            const realTimeDuration = videoDuration * TIMELAPSE_FACTOR;
            log.info(`output video is ${videoDuration.toFixed(2)}s (real-time: ${realTimeDuration.toFixed(0)}s)`);
            const thumbnailTimestamp = videoDuration / 2;

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
                    ...COMMON_FFMPEG_FLAGS,
                    ...baseThumbnailArgs,
                    "-c:v", "libaom-av1", // we use AVIF for our thumbnails as it's Baseline 2024
                    "-still-picture", "1",
                    "-crf", "26", // higher = smaller file
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
                        ...COMMON_FFMPEG_FLAGS,
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

            outputStream = fs.createReadStream(outputPath);
            thumbnailStream = fs.createReadStream(thumbOutputPath);

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

            // Yay - we're done! The ready video and timelapse have been uploaded to the right S3 buckets. The server should
            // be notified of our ready job afterwards.
            return {
                timelapseId,
                videoKey,
                thumbnailKey,
                realTimeDuration
            };
        }
        finally {
            outputStream?.close();
            thumbnailStream?.close();

            try {
                await fsp.rm(tmp, { recursive: true, force: true });
            }
            catch (err) {
                log.warn(`could not dispose of temporary job directory ${tmp}; ${err}`);
            }
        }
    },
    { connection: redis, autorun: false }
);
