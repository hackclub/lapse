import { deviceStorage } from "@/deviceStorage";
import { TIMELAPSE_FACTOR, TIMELAPSE_FPS } from "@hackclub/lapse-api";
import { assert } from "@hackclub/lapse-shared";

const FRAME_DELAY = 1000 * TIMELAPSE_FACTOR / TIMELAPSE_FPS;

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

    console.log(`(videoProcessing.ts) bitrate=${bitrate} (${bitrate / 1000}kbit/s, ${bitrate / 1000 / 1000}mbit/s), format=${mime}`);

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

    private recorder: MediaRecorder;
    private canvas: HTMLCanvasElement;
    private video: HTMLVideoElement;
    private canvasCtx: CanvasRenderingContext2D;

    constructor (provider: MediaProvider, private sessionId: number, private localTimelapseId: number) {
        this.canvas = document.createElement("canvas");
        this.canvasCtx = this.canvas.getContext("2d")!;

        const stream = this.canvas.captureStream(0); // 0 = capture frames only when we call requestFrame()

        this.video = document.createElement("video");
        this.video.srcObject = provider;

        this.recorder = createMediaRecorder(stream);
        this.recorder.addEventListener("dataavailable", this.handleRecorderData.bind(this));
        this.recorder.start(); // we will extract data via requestData()
    }

    captureFrame() {
        if (this.isPaused)
            return;

        // Blit video stream to canvas
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        this.canvasCtx.drawImage(this.video, 0, 0);

        // If we trigger any of these cases, something went wrong!
        if (this.recorder.state == "inactive") {
            console.warn("(timelapseVideoSession.ts) MediaRecorder became inactive!", this.recorder);
            this.recorder.start();
        }
        else if (this.recorder.state == "paused") {
            console.warn("(timelapseVideoSession.ts) MediaRecorder becamse paused!", this.recorder);
            this.recorder.resume();
        }

        this.recorder.requestData(); // will call handleRecorderData

        deviceStorage.appendSnapshot(this.localTimelapseId, Date.now());
    }

    async handleRecorderData(ev: BlobEvent) {
        if (ev.data.size <= 0)
            return;

        await deviceStorage.appendChunk(this.localTimelapseId, ev.data, this.sessionId);
    }
}