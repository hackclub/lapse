import { promisify } from "node:util";
import { execFile } from "node:child_process";
import type { JobLogger } from "@/log.js";

const execFileAsync = promisify(execFile);

export interface ProbedVideo {
    width: number;
    height: number;
    duration: number;
}

/**
 * Retrieves the dimensions of a video using ffprobe, and the duration by
 * fully decoding it through ffmpeg (as unfinalized WebM chunks report N/A).
 */
export async function probeVideo(file: string, log: JobLogger): Promise<ProbedVideo> {
    // Resolution: ffprobe reads stream headers reliably even for unfinalized WebMs.
    const { stdout: resOutput } = await execFileAsync("ffprobe", [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=s=x:p=0",
        file
    ]);

    const resParts = resOutput.trim().split("x");
    const width = parseInt(resParts[0], 10);
    const height = parseInt(resParts[1], 10);

    if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
        log.error(`could not determine resolution for ${file}; ffprobe output: ${resOutput}`);
        throw new Error(`could not determine resolution for ${file}`);
    }

    // Duration: decode the entire file through ffmpeg and parse the last reported time.
    let duration = NaN;

    try {
        const result = await execFileAsync("ffmpeg", [
            "-hide_banner",
            "-i", file,
            "-f", "null",
            "-"
        ]);
        duration = parseLastFfmpegTime(result.stderr);
    }
    catch (err) {
        const stderr = (err as { stderr?: string }).stderr ?? "";
        duration = parseLastFfmpegTime(stderr);

        if (isNaN(duration)) {
            log.error(`could not determine duration for ${file}; ffmpeg stderr: ${stderr}`);
            throw err;
        }
    }

    return { width, height, duration };
}

function parseLastFfmpegTime(stderr: string): number {
    const matches = [...stderr.matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)];
    if (matches.length === 0)
        return NaN;

    const last = matches[matches.length - 1];
    return parseInt(last[1]) * 3600 + parseInt(last[2]) * 60 + parseFloat(last[3]);
}

/**
 * Selects the dominant resolution - i.e., the one that'd be most suitable when combining - from the given video probes.
 */
export function selectDominantResolution(videos: ProbedVideo[]) {
    if (videos.length == 1)
        return { width: videos[0].width, height: videos[0].height };

    const bucket = new Map<string, number>();

    for (const m of videos) {
        const key = `${m.width}x${m.height}`;
        const weight = m.width * m.height * m.duration;
        bucket.set(key, (bucket.get(key) ?? 0) + weight);
    }

    let bestKey = "";
    let bestWeight = -1;

    for (const [key, weight] of bucket.entries()) {
        if (weight > bestWeight) {
            bestKey = key;
            bestWeight = weight;
        }
    }

    const [width, height] = bestKey.split("x").map(Number);
    return { width, height };
}

/**
 * Measures the duration of a video in seconds. 
 */
export async function measureVideoDuration(file: string) {
    const { stdout } = await execFileAsync("ffprobe", [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        file
    ]);

    const duration = parseFloat(stdout.trim());

    if (!Number.isFinite(duration) || duration <= 0)
        throw new Error("Unable to determine valid video duration.");

    return duration;
}
