import * as mediabunny from "mediabunny";

import { LocalTimelapse } from "@/client/deviceStorage";
import { ascending, assert } from "@/shared/common";
import { THUMBNAIL_SIZE, TIMELAPSE_FPS, TIMELAPSE_FRAME_LENGTH_MS } from "@/shared/constants";

const BITS_PER_PIXEL = 48;

/**
 * Creates a `MediaRecorder` object, the output of which will be able to be decoded client-side.
 */
export function createMediaRecorder(stream: MediaStream) {
    const tracks = stream.getVideoTracks();
    assert(tracks.length > 0, "The stream provided to MediaRecorder had no video tracks");

    const metadata = tracks[0].getSettings();

    // Sorted by preference. Note that VP8 has shown to cause decoding errors with WebCodecs.
    let mime = [
        "video/mp4;codecs=avc1",
        "video/x-matroska;codecs=avc1",
        "video/x-matroska;codecs=av1",
        "video/webm;codecs=av1",
        "video/x-matroska;codecs=vp9",
        "video/webm;codecs=vp9",
        "video/mp4;codecs=hvc1",
        "video/mp4;codecs=hev1",
        "video/x-matroska;codecs=hvc1",
        "video/x-matroska;codecs=hev1",
        "video/mp4",
        "video/x-matroska",
        "video/webm"
    ].find(x => MediaRecorder.isTypeSupported(x));

    if (!mime) {
        console.warn("(videoProcessing.ts) no video codecs are supported for MediaRecorder...?!");
        mime = "video/webm";
    }

    const w = metadata.width ?? 1920;
    const h = metadata.height ?? 1080;
    const bitrate = w * h * BITS_PER_PIXEL;

    console.log(`(videoProcessing.ts) bitrate=${bitrate} (${bitrate / 1000}kbit/s, ${bitrate / 1000 / 1000}mbit/s), format=${mime}`);

    return new MediaRecorder(stream, {
        videoBitsPerSecond: bitrate,
        audioBitsPerSecond: 0,
        mimeType: mime
    });
}

/**
 * Concatenates multiple separately recorded streams of video together.
 */
export async function videoConcat(streams: Blob[]) {
    console.log("(videoProcessing.ts) starting concatenation!", streams);

    const inputs = streams.map(
        (x) => new mediabunny.Input({
            source: new mediabunny.BlobSource(x),
            formats: mediabunny.ALL_FORMATS
        })
    );

    console.log("(videoProcessing.ts) - inputs:", inputs);
    assert(inputs.length > 0, "No inputs were passed to concat().");

    const bufTarget = new mediabunny.BufferTarget();
    const out = new mediabunny.Output({
        target: bufTarget,
        format: new mediabunny.MkvOutputFormat()
    });

    console.log("(videoProcessing.ts) - output:", out);

    const inputPrimaryTracks = (await Promise.all(inputs.map(x => x.getPrimaryVideoTrack())))
        .filter(x => {
            if (x == null) {
                console.warn("(videoProcessing.ts) input has a null primary video track - ignoring!", x);
            }

            return x != null;
        });

    assert(inputPrimaryTracks.length != 0, "No inputs had any primary video tracks!");

    const firstTrack = inputPrimaryTracks[0];

    const supportedCodecs = out.format.getSupportedVideoCodecs();
    const videoCodec = await mediabunny.getFirstEncodableVideoCodec(
        supportedCodecs,
        {
            width: firstTrack.codedWidth,
            height: firstTrack.codedHeight
        }
    );

    console.log(`(videoProcessing.ts) supported codecs: ${supportedCodecs.join()}; picked ${videoCodec}`)

    if (!videoCodec) {
        alert("Your browser doesn't seem to support video encoding.");
        throw new Error("This browser does not support video encoding.");
    }

    console.log(`(videoProcessing.ts) using ${videoCodec} to encode the video`);

    // If all tracks have the same metadata, and have the same codec, we can remux instead of re-encode - which takes a LOT less time.
    // We also get better quality with remuxing. The filesizes might be a bit larger, though.
    // We prefer remuxing over re-encoding.
    const canRemux = inputPrimaryTracks.every(
        x => (
            firstTrack.codec == x.codec &&
            firstTrack.codedWidth == x.codedWidth &&
            firstTrack.codedHeight == x.codedHeight &&
            firstTrack.displayWidth == x.displayWidth &&
            firstTrack.displayHeight == x.displayHeight
        )
    );

    console.log(`(videoProcessing.ts) remuxing ${canRemux ? "will be used, yay!" : "cannot be used."}`)
        
    const source = canRemux
        ? new mediabunny.EncodedVideoPacketSource(inputPrimaryTracks[0].codec!)
        : (
            new mediabunny.VideoSampleSource({
                codec: videoCodec,
                bitrate: mediabunny.QUALITY_HIGH,
                sizeChangeBehavior: "contain",
                latencyMode: "realtime"
            })
        );

    out.addVideoTrack(source, { frameRate: TIMELAPSE_FPS });

    const timeScale = (1000 / TIMELAPSE_FRAME_LENGTH_MS) / TIMELAPSE_FPS;
    console.log(`(videoProcessing.ts) computed timescale: ${timeScale}`);

    await out.start();

    let globalTimeOffset = 0;
    for (const video of inputPrimaryTracks) {
        console.log("(videoProcessing.ts) processing input", video);
        console.log(`(videoProcessing.ts) global time offset = ${globalTimeOffset}`);

        const decoderConfig = await video.getDecoderConfig();
        assert(decoderConfig != null, "Could not get the decoder config from the input");

        let localFirstTimestamp: number | null = null;
        let localLastTimestamp = 0;

        if (canRemux) {
            // Best-case scenario - all inputs have compatible parameters (codec, resolution, framerate), so we can simply concatenate the already encoded packets!            
            assert(source instanceof mediabunny.EncodedVideoPacketSource, "source was not a EncodedVideoPacketSource");
            const sink = new mediabunny.EncodedPacketSink(video);

            for await (const packet of sink.packets()) {
                if (packet.duration == 0) {
                    console.warn("(videoProcessing.ts) uh oh... one of the packets has a duration of 0! skipping!", packet);
                    continue;
                }

                const origTimestamp = packet.timestamp;
                if (localFirstTimestamp === null) {
                    localFirstTimestamp = origTimestamp;
                }

                const relTimestamp = origTimestamp - localFirstTimestamp;

                await source.add(
                    packet.clone({
                        timestamp: ((relTimestamp * timeScale) + globalTimeOffset),
                        duration: packet.duration * timeScale
                    }),
                    { decoderConfig }
                );

                localLastTimestamp = origTimestamp;
            }

            if (localFirstTimestamp != null) {
                globalTimeOffset += (localLastTimestamp - localFirstTimestamp) * timeScale;
            }
        }
        else {
            // This is the worst-case scenario - we have to re-encode on the client. This might take a while.
            assert(source instanceof mediabunny.VideoSampleSource, "source was not a VideoSampleSource");
            const sink = new mediabunny.VideoSampleSink(video);

            for await (const sample of sink.samples()) {
                if (sample.duration == 0) {
                    console.warn("(videoProcessing.ts) uh oh... one of the samples has a duration of 0! skipping!", sample);
                    continue;
                }

                const origTimestamp = sample.timestamp;
                if (localFirstTimestamp === null) {
                    localFirstTimestamp = origTimestamp;
                }

                const relTimestamp = origTimestamp - localFirstTimestamp;

                sample.setTimestamp((relTimestamp * timeScale) + globalTimeOffset);
                sample.setDuration(sample.duration * timeScale);

                await source.add(sample);

                localLastTimestamp = origTimestamp;
            }

            if (localFirstTimestamp != null) {
                globalTimeOffset += (localLastTimestamp - localFirstTimestamp) * timeScale;
            }
        }
    }
    
    await out.finalize();
    inputs.forEach(x => x.dispose());
    
    if (bufTarget.buffer == null) {
        console.error("(videoProcessing.ts) Buffer target was null, even though we finalized the recording!", out);
        throw new Error("bufTarget.buffer was null.");
    }

    return bufTarget.buffer;
}

/**
 * Generates a thumbnail image from a video blob.
 */
export async function videoGenerateThumbnail(videoBlob: Blob): Promise<Blob> {
    console.log("(videoProcessing.ts) generating thumbnail for", videoBlob);

    const input = new mediabunny.Input({
        source: new mediabunny.BlobSource(videoBlob),
        formats: mediabunny.ALL_FORMATS
    });

    const video = await input.getPrimaryVideoTrack();
    if (video == null) {
        console.error("(videoProcessing.ts) no primary video track for", input);
        throw new Error("Attempted to generate a thumbnail for a video without a video track.");
    }

    if (video.codec == null || !(await video.canDecode())) {
        console.error("(videoProcessing.ts) video can't be decoded on this browser!", video);
        console.error("(videoProcessing.ts) try a different one, maybe...? ^^'>");
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
        console.warn("(videoProcessing.ts) no canvases were returned for the timestamp in the middle. We'll use the first one.");
        
        canvases = await Array.fromAsync(sink.canvasesAtTimestamps([begin]));
        assert(canvases.length > 0 && canvases[0] != null, "sink.canvasesAtTimestamps for first timestamp returned nothing or null");
        
        thumbCanvas = canvases[0];
    }

    try {
        const canvas = thumbCanvas.canvas;
        if (canvas instanceof HTMLCanvasElement) {
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg"));
            if (!blob) {
                console.error("(videoProcessing.ts) canvas.toBlob() returned null!", canvas);
                throw new Error("Couldn't generate thumbnail - canvas.toBlob() returned null.");
            }

            return blob;
        }
        else {
            if (!(canvas instanceof OffscreenCanvas)) {
                console.warn("(videoProcessing.ts) canvas isn't an OffscreenCanvas OR a HTMLCanvasElement... quite suspicious...", canvas);
            }

            return await canvas.convertToBlob({ type: "image/jpeg" });
        }
    }
    finally {
        input.dispose();
    }
}

/**
 * Merges all of the potentially segmented chunks of a local timelapse to a single continous video stream.
 */
export async function mergeVideoSessions(timelapse: LocalTimelapse) {
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

    console.log("(videoProcessing.ts) mergeVideoSessions:", segmented);

    if (segmented.length == 0)
        throw new Error("Timelapse chunk segmentation resulted in an empty array");

    const streams = segmented.map(x => new Blob(x.chunks.map(x => x.data), { type: "video/webm" }));
    console.log("(videoProcessing.ts) mergeVideoSessions(): blobified streams:", streams);

    const streamBytes = await Promise.all(streams.map(x => new Response(x).blob()));
    console.log(`(videoProcessing.ts) mergeVideoSessions(): bytes retrieved from ${streamBytes.length} streams:`, streamBytes);
    
    const concatenated = await videoConcat(streamBytes);
    return new Blob([concatenated]);
}