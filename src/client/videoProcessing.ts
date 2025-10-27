import * as mediabunny from "mediabunny";

import { LocalTimelapse } from "./deviceStorage";
import { ascending, assert } from "@/shared/common";
import { THUMBNAIL_SIZE, TIMELAPSE_FPS, TIMELAPSE_FRAME_LENGTH } from "@/shared/constants";

export async function createVideoProcessor() {
    // TODO: this is a relic and can be removed
    return new VideoProcessor();
}

export class VideoProcessor {
    /**
     * Concatenates multiple separately recorded streams of video together.
     */
    async concat(streams: Blob[]) {
        console.log("(encode.concat) starting concatenation!", streams);

        const inputs = streams.map(x => new mediabunny.Input({
            source: new mediabunny.BlobSource(x),
            formats: mediabunny.ALL_FORMATS
        }));

        console.log("(encode.concat) - inputs:", inputs);
        assert(inputs.length > 0, "No inputs were passed to concat().");

        const bufTarget = new mediabunny.BufferTarget();
        const out = new mediabunny.Output({
            target: bufTarget,
            format: new mediabunny.WebMOutputFormat()
        });

        console.log("(encode.concat) - output:", out);

        const firstVideoTracks = await inputs[0].getVideoTracks();
        assert(firstVideoTracks.length > 0, "The first media file passed in had no video tracks.")
        console.log("(encode.concat) - tracks of inputs[0]:", firstVideoTracks);

        const videoCodec = await mediabunny.getFirstEncodableVideoCodec(
            out.format.getSupportedVideoCodecs(),
            {
                width: firstVideoTracks[0].codedWidth,
                height: firstVideoTracks[0].codedHeight
            }
		);

        if (!videoCodec) {
            alert("Your browser doesn't seem to support video encoding.");
            throw new Error("This browser does not support video encoding.");
        }

        console.log(`(encode.concat) using ${videoCodec} to encode the video`);

        assert(firstVideoTracks[0].codec != null, "First video track has no codec (or an unsupported one)");
        const source = new mediabunny.VideoSampleSource({
            codec: videoCodec,
            bitrate: mediabunny.QUALITY_MEDIUM
        });

        out.addVideoTrack(source, { frameRate: TIMELAPSE_FPS })

        const timeScale = (1000 / TIMELAPSE_FRAME_LENGTH) / TIMELAPSE_FPS;
        console.log(`(encode.concat) computed timescale: ${timeScale}`);

        await out.start();

        let globalTimeOffset = 0;
        for (const input of inputs) {
            console.log("(encode.concat) processing input", input);

            const video = await input.getPrimaryVideoTrack();
            if (!video) {
                console.error("(encode.concat) input", input, "has no primary video track!");
                throw new Error("A video input has no primary video track.");
            }

            const decoderConfig = await video.getDecoderConfig();
            if (!decoderConfig) {
                console.error("(encode.concat) input", video, "has no decoder config!");
                throw new Error("A video input has no decoder config."); 
            }

            const sink = new mediabunny.VideoSampleSink(video);

            let localFirstTimestamp: number | null = null;
            let localLastTimestamp = 0;
            for await (const sample of sink.samples()) {
                if (localFirstTimestamp === null) {
                    localFirstTimestamp = sample.timestamp;
                }

                const relTimestamp = sample.timestamp - localFirstTimestamp;

                sample.setTimestamp((relTimestamp * timeScale) + globalTimeOffset);
                sample.setDuration(sample.duration * timeScale);

                await source.add(sample);
                
                localLastTimestamp = sample.timestamp;
            }

            if (localFirstTimestamp != null) {
                globalTimeOffset += (localLastTimestamp - localFirstTimestamp) * timeScale;
            }
        }
        
        await out.finalize();
        
        if (bufTarget.buffer == null) {
            console.error("(encode.concat) Buffer target was null, even though we finalized the recording!", out);
            throw new Error("bufTarget.buffer was null.");
        }

        return bufTarget.buffer;
    }

    /**
     * Generates a thumbnail image from a video blob.
     */
    async generateThumbnail(videoBlob: Blob): Promise<Blob> {
        console.log("(encode.thumbnail) generating thumbnail for", videoBlob);

        const input = new mediabunny.Input({
            source: new mediabunny.BlobSource(videoBlob),
            formats: mediabunny.ALL_FORMATS
        });

        const video = await input.getPrimaryVideoTrack();
        if (video == null) {
            console.error("(encode.thumbnail) no primary video track for", input);
            throw new Error("Attempted to generate a thumbnail for a video without a video track.");
        }

        if (video.codec == null || !(await video.canDecode())) {
            console.error("(encode.thumbnail) video can't be decoded on this browser!", video);
            console.error("(encode.thumbnail) try a different one, maybe...? ^^'>");
            throw new Error("Unsupported codec. Try using a different browser.");
        }

        const dimension = (d1: number, d2: number) => d1 > d2
			? THUMBNAIL_SIZE
			: Math.floor(THUMBNAIL_SIZE * d1 / d2);

		const width = dimension(video.displayWidth, video.displayHeight);
        const height = dimension(video.displayHeight, video.displayWidth);

        const sink = new mediabunny.CanvasSink(video, {
            width: Math.floor(width * window.devicePixelRatio),
            height: Math.floor(height * window.devicePixelRatio),
            fit: "fill"
        });

        const begin = await video.getFirstTimestamp();
        const end = await video.computeDuration();

        let thumbCanvas: mediabunny.WrappedCanvas;

        let canvases = await Array.fromAsync(sink.canvasesAtTimestamps([begin + (end - begin) / 2]));
        if (canvases.length > 0 && canvases[0]) {
            thumbCanvas = canvases[0];
        }
        else {
            console.warn("(encode.thumbnail) no canvases were returned for the timestamp in the middle. We'll use the first one.");
            
            canvases = await Array.fromAsync(sink.canvasesAtTimestamps([begin]));
            assert(canvases.length > 0 && canvases[0] != null, "sink.canvasesAtTimestamps for first timestamp returned nothing or null");
            
            thumbCanvas = canvases[0];
        }

        const canvas = thumbCanvas.canvas;
        if (canvas instanceof HTMLCanvasElement) {
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg"));
            if (!blob) {
                console.error("(encode.thumbnail) canvas.toBlob() returned null!", canvas);
                throw new Error("Couldn't generate thumbnail - canvas.toBlob() returned null.");
            }

            return blob;
        }
        else {
            if (!(canvas instanceof OffscreenCanvas)) {
                console.warn("(encode.thumbnail) canvas isn't an OffscreenCanvas OR a HTMLCanvasElement... quite suspicious...", canvas);
            }

            return await canvas.convertToBlob({ type: "image/jpeg" });
        }
    }
}

/**
 * Generates a thumbnail image from a video blob.
 */
export async function generateThumbnail(
    processor: VideoProcessor,
    videoBlob: Blob
): Promise<Blob> {
    return processor.generateThumbnail(videoBlob);
}

/**
 * Merges all of the potentially segmented chunks of a local timelapse to a single continous
 * video stream.
 */
export async function mergeVideoSessions(processor: VideoProcessor, timelapse: LocalTimelapse) {
    if (timelapse.chunks.length === 0)
        throw new Error("No chunks were found when stopping the recording. Have we forgotten to capture any?!");

    // Chunks that come from different sessions have to be processed with WebCodecs. If we have
    // only one session (i.e. the user begun and ended the recording without refreshing/closing
    // the tab), then we can skip the WebCodecs step and simply serve the first (and only) segment.

    const segmented = Object.entries(Object.groupBy(timelapse.chunks, x => x.session))
        .filter(x => x[1])
        .map(x => ({
            session: x[0],
            chunks: x[1]!.toSorted(ascending(x => x.timestamp))
        }));

    console.log("mergeVideoSessions():", segmented);

    if (segmented.length == 0)
        throw new Error("Timelapse chunk segmentation resulted in an empty array");

    const streams = segmented.map(x => new Blob(x.chunks.map(x => x.data), { type: "video/webm" }));
    console.log("mergeVideoSessions(): blobified streams:", streams);

    const streamBytes = await Promise.all(streams.map(x => new Response(x).blob()));
    console.log(`mergeVideoSessions(): bytes retrieved from ${streamBytes.length} streams:`, streamBytes);
    
    const concatenated = await processor.concat(streamBytes);
    return new Blob([concatenated]);
}