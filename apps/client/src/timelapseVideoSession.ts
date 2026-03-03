import { deviceStorage } from "@/deviceStorage";
import { TIMELAPSE_FACTOR, TIMELAPSE_FPS } from "@hackclub/lapse-api";
import { assert } from "@hackclub/lapse-shared";

const BITS_PER_PIXEL = 48;
function createMediaRecorder(stream: MediaStream) {
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

    console.log(`(videoProcessing.ts) bitrate=${bitrate} (${Math.floor(bitrate / 1000)}kbit/s, ${Math.floor(bitrate / 1000 / 1000)}mbit/s), format=${mime}`);

    return new MediaRecorder(stream, {
        videoBitsPerSecond: bitrate,
        audioBitsPerSecond: 0,
        mimeType: mime
    });
}

/**
 * Represents a client-side video session belonging to a `Timelapse`. A session is defined as a
 * continous stream of video that has consistent parameters (e.g. resolution) across its lifespan.
 */
export class TimelapseVideoSession {
    public isPaused: boolean = false;
    public readonly sessionId: number;

    private recorder: MediaRecorder;
    private canvas: HTMLCanvasElement;
    private video: HTMLVideoElement;
    private canvasCtx: CanvasRenderingContext2D;
    private canvasStreamTrack: CanvasCaptureMediaStreamTrack;
    private intervalId: ReturnType<typeof setInterval>;

    /**
     * Creates a new `TimelapseVideoSession`, immediately capturing new chunks.
     * @param provider The media provider (most likely a video stream) to blit frames *from*.
     */
    constructor (provider: MediaProvider) {
        this.sessionId = Date.now();
        this.canvas = document.createElement("canvas");
        this.canvasCtx = this.canvas.getContext("2d")!;

        const stream = this.canvas.captureStream(0); // 0 = capture frames only when we call requestFrame()

        this.video = document.createElement("video");
        this.video.autoplay = true;
        this.video.srcObject = provider;
        this.canvasStreamTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;

        this.recorder = createMediaRecorder(stream);
        this.recorder.ondataavailable = (ev) => this.handleRecorderData(ev);
        this.recorder.start(); // we will extract data via requestData()
    
        this.intervalId = this.setFrameInterval();
    }

    // Starts capturing data.
    private setFrameInterval() {
        return setInterval(() => {
            this.captureFrame();
        }, 1000 * TIMELAPSE_FACTOR / TIMELAPSE_FPS);
    }

    // Captures a single frame (not a chunk!)
    private captureFrame() {
        if (this.isPaused)
            return;

        // Blit video stream to canvas
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        this.canvasCtx.drawImage(this.video, 0, 0);
        this.canvasStreamTrack.requestFrame();

        if (this.recorder.state == "inactive") {
            console.warn("(timelapseVideoSession.ts) MediaRecorder became inactive!", this.recorder);
            this.recorder.start();
        }
        else if (this.recorder.state == "paused") {
            console.warn("(timelapseVideoSession.ts) MediaRecorder becamse paused!", this.recorder);
            this.recorder.resume();
        }

        this.recorder.requestData(); // will call handleRecorderData

        deviceStorage.appendSnapshot(Date.now());
    }

    private async handleRecorderData(ev: BlobEvent) {
        if (ev.data.size <= 0)
            return;

        await deviceStorage.appendChunk(this.sessionId, ev.data);
    }

    /**
     * Stops the internal `MediaRecorder`, waiting for all data to be flushed.
     */
    stop(): Promise<void> {
        return new Promise<void>(resolve => {
            clearInterval(this.intervalId);

            this.recorder.onstop = () => resolve();
            this.recorder.stop();
        });
    }

    pause() {
        this.recorder.pause();
        clearInterval(this.intervalId);
    }

    resume() {
        this.recorder.resume();
        this.intervalId = this.setFrameInterval();
    }
}