import { THUMBNAIL_SIZE } from "@hackclub/lapse-api";
import { KeyOfType, last } from "@hackclub/lapse-shared";

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
            video.currentTime = video.duration / 2;
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
