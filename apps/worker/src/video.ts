import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { assert } from "@hackclub/lapse-shared";

const execFileAsync = promisify(execFile);

export interface ProbedVideo {
    width: number;
    height: number;
    duration: number;
}

/**
 * Retrieves the duration and dimensions of a video.
 */
export async function probeVideo(file: string): Promise<ProbedVideo> {
    const { stdout } = await execFileAsync("ffprobe", [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height:format=duration",
        "-of", "json",
        file
    ]);

    const parsed = JSON.parse(stdout);
    const stream = parsed.streams[0];

    const width = parseFloat(stream.width);
    const height = parseFloat(stream.height);
    const duration = parseFloat(parsed.format.duration);

    assert(!isNaN(width), "stream.width wasn't a number");
    assert(!isNaN(height), "stream.height wasn't a number");

    return { width, height, duration };
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
