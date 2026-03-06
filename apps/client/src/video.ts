import { sleep } from "@/common";
import { THUMBNAIL_SIZE, TIMELAPSE_FPS } from "@hackclub/lapse-api";
import { assert, KeyOfType, last } from "@hackclub/lapse-shared";

import * as mediabunny from "mediabunny";

const FILMSTRIP_WIDTH = 300;
const FILMSTRIP_HEIGHT = 200;

/**
 * Generates a preview thumbnail for a given video.
 */
export async function videoGenerateThumbnail(videoBlob: Blob): Promise<Blob> {
    console.log("(videoProcessing.ts) generating thumbnail for", videoBlob);

    const canvas = document.createElement("canvas");
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(videoBlob);

    try {
        video.autoplay = true;
        video.muted = true;

        await new Promise<void>((resolve, reject) => {
            video.onloadeddata = () => resolve();
            video.onerror = (err) => reject(err);
            video.src = objectUrl;
        });

        const duration = await videoDuration(video) ?? 1;

        const dimension = (d1: number, d2: number) => d1 > d2
            ? THUMBNAIL_SIZE
            : Math.floor(THUMBNAIL_SIZE * d1 / d2);

        const width = dimension(video.videoWidth, video.videoHeight);
        const height = dimension(video.videoHeight, video.videoWidth);

        canvas.width = Math.floor(width * window.devicePixelRatio);
        canvas.height = Math.floor(height * window.devicePixelRatio);

        const ctx = canvas.getContext("2d");
        if (!ctx)
            throw new Error("Could not get 2D context from canvas");

        await new Promise<void>((resolve, reject) => {
            video.onseeked = () => resolve();
            video.onerror = (err) => reject(err);
            video.currentTime = duration / 2;
        });

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        video.pause();

        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp"));
        if (!blob)
            throw new Error("canvas.toBlob() returned null in fallback");

        return blob;
    }
    catch (err) {
        console.warn("(videoProcessing.ts) could not generate thumbnail - falling back to black image!", err);
        return await fetch(`data:image/webp;base64,UklGRiwAAABXRUJQVlA4TB8AAAAvf8JZAAcQEf0PCAkS/4+3EtH/jP/85z//+c9//l8AAA==`).then(x => x.blob());
    }
    finally {
        URL.revokeObjectURL(objectUrl);
        video.remove();
        canvas.remove();
    }
}

/**
 * Gets the target video (and the value to subtract from `t` in order to get the timestamp inside said video) from a
 * logically sequential collection of videos.
 */
export function getVideoAtSequenceTime(t: number, videos: { url: string, duration: number }[]) {
    let base = 0;
    for (const session of videos) {
        const prevBase = base;
        base += session.duration;

        if (base >= t) {
            return {
                url: session.url,
                timeBase: prevBase
            };
        }
    }

    console.warn(`([id].tsx) time ${t} is outside the bounds of all sessions, returning the last one`);
    return {
        url: last(videos).url,
        timeBase: base
    };
}

export async function waitForVideoEvent(video: HTMLVideoElement, event: "onload" | "onseeked" | "onloadedmetadata" | "onloadeddata", procedure?: () => void) {
    await new Promise<void>((resolve, reject) => {
        video.onerror = (err) => reject(typeof err === "string" ? err : err.target instanceof HTMLVideoElement ? err.target.error : err);
        video[event] = () => resolve();
        procedure?.();
    });
}

/**
 * Spreads indices [0...max] in a uniform-like fashion, leaving gaps in the beginning of the iterations and progressively filling them in.
 * This is used for thumbnail generation.
 */
function* spreadIndices(max: number): Generator<number> {
    if (max < 0)
        return;

    if (max === 0) {
        yield 0;
        return;
    }

    yield 0;
    yield max;

    const gaps: Array<[number, number]> = [[0, max]]; // [lo, hi]

    while (gaps.length) {
        // pick the widest gap
        let best = 0;
        for (let i = 1; i < gaps.length; i++) {
            if (gaps[i][1] - gaps[i][0] > gaps[best][1] - gaps[best][0]) {
                best = i;
            }
        }

        const [lo, hi] = gaps.splice(best, 1)[0];
        if (hi - lo <= 1)
            continue;

        const mid = Math.floor((lo + hi) / 2);
        yield mid;

        gaps.push([lo, mid], [mid, hi]);
    }
}

export async function* makeFilmstrip(count: number, sessions: { url: string; duration: number; }[]): AsyncGenerator<{ idx: number, url: string }> {
    try {
        let generatedCount = 0;

        for await (const x of makeFilmstripFast(count, sessions)) {
            yield x;
            generatedCount++;
        }

        if (generatedCount != count) {
            // This usually happens when the timelapse is REALLY short. Like, less than 5 minutes. This isn't that big of a concern
            // to us, so the user will see the timeline fill up from the left, and then gradually get filled in via the safe procedure.
            throw new Error(`Generated only ${generatedCount} parts out of ${count}`);
        }
    }
    catch (err) {
        console.warn("(video.ts) mediabunny filmstrip generation failed, falling back to video element method", err);
        for await (const x of makeFilmstripSafe(count, sessions)) {
            yield x;
        }
    }
}

async function* makeFilmstripFast(count: number, sessions: { url: string; duration: number }[]): AsyncGenerator<{ idx: number, url: string }> {
    const totalTime = sessions.reduce((a, x) => a + x.duration, 0);

    let idx = 0;
    let sessionTimebase = 0;

    let prevMatch: mediabunny.WrappedCanvas | null = null;
    let prevDiff = Infinity;

    let desiredTimestamp = 0;

    for (const session of sessions) {
        const source = new mediabunny.UrlSource(session.url);
        const input = new mediabunny.Input({
            source,
            formats: [mediabunny.WEBM, mediabunny.MP4] // technically, MP4 shouldn't ever appear but just in case, we include support
        });

        const videoTrack = await input.getPrimaryVideoTrack();
        if (!videoTrack)
            throw new Error("File has no video track.");

        if (videoTrack.codec === null)
            throw new Error("Unsupported video codec.");

        if (!(await videoTrack.canDecode()))
            throw new Error("Unable to decode the video track.");
        
        const sink = new mediabunny.CanvasSink(videoTrack, {
            width: FILMSTRIP_WIDTH,
            height: FILMSTRIP_HEIGHT,
            fit: "cover"
        });
        
        for await (const wrap of sink.canvases()) {
            const diff = Math.abs(wrap.timestamp - (desiredTimestamp - sessionTimebase));

            if (
                (prevMatch == null) ||
                (prevDiff > diff)
            ) {
                // The current sample has a smaller difference than the previous one. Keep track of this and move on to the next one.
                prevMatch = wrap;
                prevDiff = diff;
                continue;
            }

            // Okay - so here, our diff actually INCREASED from what we had before - i.e., this is a worst match, so we're going further away from
            // our desired timestamp. Thus, the previous match was the best one.
            const canvas = prevMatch.canvas;
            assert(canvas instanceof HTMLCanvasElement, "wrap.canvas was an OffscreenCanvas");

            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", 0.25));
            if (!blob)
                throw new Error(`canvas.toBlob returned null for index ${idx} (timestamp ${desiredTimestamp})`);

            yield { idx, url: URL.createObjectURL(blob) };

            idx++;
            desiredTimestamp = (idx / count) * totalTime;

            prevMatch = null;
            prevDiff = Infinity;

            if (desiredTimestamp > sessionTimebase + session.duration) {
                // The timestamp we want is outside this session. Let's stop iterating over its samples.
                break;
            }
        }

        sessionTimebase += session.duration;
        prevMatch = null;
        prevDiff = Infinity;

        input.dispose();
    }
}

async function* makeFilmstripSafe(count: number, sessions: { url: string; duration: number }[]): AsyncGenerator<{ idx: number, url: string }> {
    const totalTime = sessions.reduce((a, x) => a + x.duration, 0);
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    canvas.width = FILMSTRIP_WIDTH;
    canvas.height = FILMSTRIP_HEIGHT;
    const ctx = canvas.getContext("2d")!;

    for (const i of spreadIndices(count)) {
        const t = totalTime * (i / count);
        const data = getVideoAtSequenceTime(t, sessions);

        if (video.src != data.url) {
            video.src = data.url;
        }

        await new Promise<void>(async (resolve, reject) => {
            video.onseeked = () => resolve();
            video.onerror = (err) => reject(err);
            video.currentTime = Math.max(0.01, t - data.timeBase);

            await sleep(100);
            if (!video.seeking) {
                console.log("(EditorTimeline.tsx) video hasn't been seeking - assuming it already has finished");
                resolve();
            }
        });

        ctx.drawImage(video, 0, 0, FILMSTRIP_WIDTH, FILMSTRIP_HEIGHT);

        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", 0.25));
        if (blob) {
            yield { idx: i, url: URL.createObjectURL(blob) };
        }
    }
}

/**
 * Changes the rate of a video to `rate`. If the operation fails, `null` is returned instead.
 */
export async function changeVideoRate(videoUrl: string, rate: number) {
    const inSource = new mediabunny.UrlSource(videoUrl);
    const input = new mediabunny.Input({
        source: inSource,
        formats: [mediabunny.WEBM, mediabunny.MP4] // technically, MP4 shouldn't ever appear but just in case, we include support
    });

    const bufTarget = new mediabunny.BufferTarget();

    const track = await input.getPrimaryVideoTrack();
    if (track == null || !track.codec) {
        console.warn("(video.ts) could not speed up video using MediaBunny; primary video track (or its codec) was null");
        return null;
    }

    const outSource = new mediabunny.EncodedVideoPacketSource(track.codec!);
    const out = new mediabunny.Output({
        target: bufTarget,
        format: new mediabunny.WebMOutputFormat()
    });

    out.addVideoTrack(outSource, { frameRate: TIMELAPSE_FPS });
        
    let firstTimestamp: number | null = null;

    const decoderConfig = await track.getDecoderConfig();
    if (!decoderConfig) {
        console.warn("(video.ts) could not speed up video using MediaBunny; decoder config was null");
        return null;
    }

    const sink = new mediabunny.EncodedPacketSink(track);
    for await (const packet of sink.packets()) {
        if (packet.duration == 0) {
            console.warn("(video.ts) uh oh... one of the packets has a duration of 0! skipping!", packet);
            continue;
        }

        const origTimestamp = packet.timestamp;
        if (firstTimestamp === null) {
            firstTimestamp = origTimestamp;
        }

        const relTimestamp = origTimestamp - firstTimestamp;

        await outSource.add(
            packet.clone({
                timestamp: relTimestamp / rate,
                duration: packet.duration / rate
            }),
            { decoderConfig }
        );
    }

    await out.finalize();
    input.dispose();

    return bufTarget.buffer
        ? URL.createObjectURL(new Blob([bufTarget.buffer], { type: "video/webm" }))
        : null;
}

/**
 * Gets the duration of a video, also supporting videos without duration in their metadata. If an existing `<video>` element
 * is provided, it will be loaded and re-seeked to get the duration.
 */
export async function videoDuration(srcOrVideo: string | HTMLVideoElement) {
    const video = srcOrVideo instanceof HTMLVideoElement ? srcOrVideo : document.createElement("video");
    if (typeof srcOrVideo === "string") {
        video.src = srcOrVideo;
    }

    if (isFinite(video.duration))
        return video.duration;

    // With unfinalized data, we want to force the browser to seek the entire file.
    await waitForVideoEvent(video, "onloadeddata", () => video.load());
    await waitForVideoEvent(video, "onseeked", () => video.currentTime = Number.MAX_SAFE_INTEGER);
    await waitForVideoEvent(video, "onseeked", () => video.currentTime = 0.1);

    if (!isFinite(video.duration))
        return null;

    return video.duration;
}
