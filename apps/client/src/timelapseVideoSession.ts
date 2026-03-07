import { deviceStorage } from "@/deviceStorage";
import { TIMELAPSE_FACTOR, TIMELAPSE_FPS } from "@hackclub/lapse-api";
import { assert } from "@hackclub/lapse-shared";

const BITS_PER_PIXEL = 48;
function createMediaRecorder(stream: MediaStream) {
  const tracks = stream.getVideoTracks();
  assert(tracks.length > 0, "The stream provided to MediaRecorder had no video tracks");

  const metadata = tracks[0].getSettings();

  const w = metadata.width ?? 1920;
  const h = metadata.height ?? 1080;
  const bitrate = w * h * BITS_PER_PIXEL;

  console.log(`(videoProcessing.ts) bitrate=${bitrate} (${Math.floor(bitrate / 1000)}kbit/s, ${Math.floor(bitrate / 1000 / 1000)}mbit/s)`);

  return new MediaRecorder(stream, {
    videoBitsPerSecond: bitrate,
    audioBitsPerSecond: 0
  });
}

const CAPTURE_INTERVAL_MS = 1000 * TIMELAPSE_FACTOR / TIMELAPSE_FPS;

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
  private intervalId: ReturnType<typeof setInterval>;
  private canvasTrack: { synced: true, stream: CanvasCaptureMediaStreamTrack } | { synced: false, stream: MediaStreamVideoTrack };

  /**
   * Creates a new `TimelapseVideoSession`, immediately capturing new chunks.
   * @param provider The media provider (most likely a video stream) to blit frames *from*.
   */
  constructor(provider: MediaProvider) {
    this.sessionId = Date.now();
    this.canvas = document.createElement("canvas");
    this.canvasCtx = this.canvas.getContext("2d")!;

    let stream: MediaStream;

    if ("CanvasCaptureMediaStreamTrack" in window) {
      stream = this.canvas.captureStream(0) // 0 = capture frames only when we call requestFrame()
      this.canvasTrack = {
        synced: true,
        stream: stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
      };
    }
    else {
      // This is the case with Firefox. This means we can get some desync or duplicate frames...
      stream = this.canvas.captureStream(TIMELAPSE_FPS / TIMELAPSE_FACTOR);
      this.canvasTrack = {
        synced: false,
        stream: stream.getVideoTracks()[0]
      };
    }

    this.video = document.createElement("video");
    this.video.autoplay = true;
    this.video.srcObject = provider;

    this.recorder = createMediaRecorder(stream);
    this.recorder.ondataavailable = (ev) => this.handleRecorderData(ev);
    this.recorder.start(CAPTURE_INTERVAL_MS);

    this.intervalId = this.setFrameInterval();
  }

  // Starts capturing data.
  private setFrameInterval() {
    return setInterval(() => {
      this.captureFrame();
    }, CAPTURE_INTERVAL_MS);
  }

  // Captures a single frame (not a chunk!)
  private captureFrame() {
    if (this.isPaused)
      return;

    // Blit video stream to canvas
    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;
    this.canvasCtx.drawImage(this.video, 0, 0);

    if (this.canvasTrack.synced) {
      this.canvasTrack.stream.requestFrame();
    }

    if (this.recorder.state == "inactive") {
      console.warn("(timelapseVideoSession.ts) MediaRecorder became inactive!", this.recorder);
      this.recorder.start(CAPTURE_INTERVAL_MS);
    }
    else if (this.recorder.state == "paused") {
      console.warn("(timelapseVideoSession.ts) MediaRecorder became paused!", this.recorder);
      this.recorder.resume();
    }

    this.recorder.requestData(); // will call handleRecorderData

    deviceStorage.appendSnapshot(Date.now());
  }

  private async handleRecorderData(ev: BlobEvent) {
    if (ev.data.size <= 0) {
      console.warn("(timelapseVideoSession.ts) ignoring empty video chunk", ev);
      return;
    }

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
    this.isPaused = true;
    this.recorder.pause();
    clearInterval(this.intervalId);
  }

  resume() {
    this.isPaused = false;
    this.recorder.resume();
    this.intervalId = this.setFrameInterval();
  }
}