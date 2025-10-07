import { FFmpeg } from "@ffmpeg/ffmpeg";

import { ascending, assert, range, typeName } from "@/shared/common";
import { LocalTimelapse } from "./deviceStorage";
import { TIMELAPSE_FPS, TIMELAPSE_FRAME_LENGTH } from "@/shared/constants";

async function toBlobURL(url: string, mimeType: string): Promise<string> {
    const response = await fetch(url);
    const blob = await response.blob();
    return URL.createObjectURL(new Blob([blob], { type: mimeType }));
}

export async function createVideoProcessor() {
    const processor = new VideoProcessor();
    await processor.initialize();
    return processor;
}

export class VideoProcessor {
    private ffmpeg: FFmpeg | null = null;
    private initialized = false;
    private progressCallback: ((stage: string, progress: number) => void) | null = null;

    async initialize(): Promise<void> {
        if (this.initialized)
            return;

        this.ffmpeg = new FFmpeg();

        this.ffmpeg.on("log", ({ message }) => {
            console.log(`(ffmpeg) ${message}`);
        });

        this.ffmpeg.on("progress", ({ progress, time }) => {
            if (this.progressCallback) {
                const percent = Math.floor(progress * 100);
                const timeStr = time ? ` (${Math.floor(time / 1000)}s)` : "";
                this.progressCallback(`Processing video... ${percent}%${timeStr}`, percent);
            }
        });

        const knownCdns = [
            {
                name: "jsdelivr",
                coreURL: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js",
                wasmURL: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm",
            },
            {
                name: "unpkg-umd",
                coreURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js",
                wasmURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm",
            },
            {
                name: "skypack",
                coreURL: "https://cdn.skypack.dev/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js",
                wasmURL: "https://cdn.skypack.dev/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm",
            },
        ];

        for (const cdn of knownCdns) {
            try {
                console.log(`(ffmpeg) loading from CDN:`, cdn);

                await this.ffmpeg.load({
                    coreURL: await toBlobURL(cdn.coreURL, "text/javascript"),
                    wasmURL: await toBlobURL(cdn.wasmURL, "application/wasm"),
                });

                this.initialized = true;
                console.log(`(ffmpeg) loaded successfully from ${cdn.name}!`);
                break;
            }
            catch (attemptError) {
                console.warn(`(ffmpeg) could not load from CDN ${cdn.name}`, attemptError);
            }
        }

        if (!this.initialized) {
            throw new Error("Could not load FFMpeg from any CDN");
        }
    }

    /**
     * Concatenates multiple separately recorded streams of video together.
     */
    async concat(
        streams: Uint8Array<ArrayBufferLike>[], 
        onProgress?: (stage: string, progress: number) => void
    ) {
        assert(this.ffmpeg != null, "attempted to call concat() when this.ffmpeg is null");

        const totalSteps = streams.length + 3; // write segments + write inputs.txt + exec + read output
        let currentStep = 0;
        let ffmpegStartStep = 0;

        const updateProgress = (stage: string) => {
            currentStep++;
            const progress = Math.floor((currentStep / totalSteps) * 100);
            onProgress?.(stage, progress);
        };

        const originalCallback = this.progressCallback;
        this.progressCallback = (stage: string, ffmpegProgress: number) => {
            // Map FFmpeg progress to overall progress (between ffmpegStartStep and next step)
            const stepProgress = ffmpegStartStep + (ffmpegProgress / 100);
            const totalProgress = Math.floor((stepProgress / totalSteps) * 100);
            onProgress?.(stage, totalProgress);
        };

        for (let i = 0; i < streams.length; i++) {
            console.log(`(ffmpeg) copying segment ${i} to fs`);
            await this.ffmpeg.writeFile(`segment${i}.webm`, streams[i]);
            updateProgress(`Preparing segment ${i + 1}/${streams.length}...`);
        }

        await this.ffmpeg.writeFile(
            "inputs.txt",
            range(streams.length)
                .map(i => `file 'segment${i}.webm'`)
                .join("\n")
        );
        updateProgress("Creating concat list...");

        console.log("(ffmpeg) concatenating!");
        ffmpegStartStep = currentStep;

        await this.ffmpeg.exec([
            "-f", "concat",
            "-itsscale", ((1000 / TIMELAPSE_FRAME_LENGTH) / TIMELAPSE_FPS).toString(),
            "-i", "inputs.txt",
            "-c", "copy",
            "-progress", "pipe:1",
            "output.webm"
        ]);
        
        // Restore original callback
        this.progressCallback = originalCallback;
        updateProgress("Video processing complete...");

        console.log("(ffmpeg) concat ended! reading file...");
        const data = await this.ffmpeg.readFile("output.webm");
        updateProgress("Reading processed video...");

        assert(data instanceof Uint8Array, `readFile for output.webm returned a ${typeName(data)}`);

        console.log("(ffmpeg) successfully concatenated!", data);
        return data;
    }
}

/**
 * Merges all of the potentially segmented chunks of a local timelapse to a single continous
 * video stream.
 */
export async function mergeVideoSessions(
    processor: VideoProcessor, 
    timelapse: LocalTimelapse,
    onProgress?: (stage: string, progress: number) => void
) {
    if (timelapse.chunks.length === 0)
        throw new Error("No chunks were found when stopping the recording. Have we forgotten to capture any?!");

    // Chunks that come from different sessions have to be processed with FFMpeg. If we have
    // only one session (i.e. the user begun and ended the recording without refreshing/closing
    // the tab), then we can skip the FFMpeg step and simply serve the first (and only) segment.

    const segmented = Object.entries(Object.groupBy(timelapse.chunks, x => x.session))
        .filter(x => x[1])
        .map(x => ({
            session: x[0],
            chunks: x[1]!.toSorted(ascending(x => x.timestamp))
        }));

    console.log("mergeVideoSessions():", segmented);

    if (segmented.length == 0)
        throw new Error("Timelapse chunk segmentation resulted in an empty array");

    onProgress?.("Preparing video streams...", 10);
    const streams = segmented.map(x => new Blob(x.chunks.map(x => x.data), { type: "video/webm" }));

    console.log("mergeVideoSessions(): blobified streams:", streams);

    onProgress?.("Converting streams to bytes...", 20);
    const streamBytes = await Promise.all(streams.map(x => new Response(x).bytes()));
    
    console.log(`mergeVideoSessions(): bytes retrieved from ${streamBytes.length} streams:`, streamBytes);
    
    onProgress?.("Processing with FFmpeg...", 30);
    const concatenated = await processor.concat(streamBytes, (stage, progress) => {
        onProgress?.(stage, (30 + Math.floor(progress * 0.6)) );
    });
    
    onProgress?.("Finalizing video...", 95);
    return new Blob([concatenated.buffer as ArrayBuffer]);
}