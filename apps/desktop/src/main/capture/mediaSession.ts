/**
 * MediaSession -- capture logic that runs inside the hidden BrowserWindow.
 *
 * This is a *renderer-side* module (runs in a DOM context). It mirrors the
 * web client's `TimelapseVideoSession` but communicates with the main process
 * via the `captureApi` bridge exposed by `capturePreload.ts`.
 *
 * Flow:
 *   1. Main process sends `capture:init` with a sourceId.
 *   2. This module acquires a desktop media stream using `getUserMedia` with
 *      Electron's `chromeMediaSource: "desktop"` constraint.
 *   3. A canvas-based frame capture loop runs at CAPTURE_INTERVAL_MS.
 *   4. MediaRecorder encodes the canvas stream to webm.
 *   5. Chunks and snapshot timestamps are sent back to main via IPC.
 */

import type { CaptureApi } from "./capturePreload";

declare global {
  interface Window {
    captureApi: CaptureApi;
  }
}

// Re-export so captureWindow.ts does not need its own declare global
export type { CaptureApi };

// Timelapse timing constants (matching web client and shared/types.ts)
const TIMELAPSE_FACTOR = 60;
const TIMELAPSE_FPS = 24;
const CAPTURE_INTERVAL_MS = (1000 * TIMELAPSE_FACTOR) / TIMELAPSE_FPS; // ~2500ms
const BITS_PER_PIXEL = 48;

class MediaSession {
  private recorder: MediaRecorder | null = null;
  private canvas: HTMLCanvasElement;
  private canvasCtx: CanvasRenderingContext2D;
  private video: HTMLVideoElement;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isPaused = false;
  private mediaStream: MediaStream | null = null;
  private canvasTrack: { synced: true; stream: CanvasCaptureMediaStreamTrack } | { synced: false; stream: MediaStreamTrack };

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvasCtx = this.canvas.getContext("2d")!;
    this.video = document.createElement("video");
    this.video.autoplay = true;
    this.video.muted = true;

    // Default -- will be overwritten once we have a stream
    this.canvasTrack = { synced: false, stream: null as unknown as MediaStreamTrack };
  }

  /**
   * Acquires the desktop stream for `sourceId` and starts the
   * MediaRecorder + frame capture loop.
   */
  async start(sourceId: string): Promise<void> {
    // Acquire screen stream using Electron's chromeMediaSource constraint
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        // @ts-expect-error -- Electron-specific constraint
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: sourceId
        }
      }
    });

    this.video.srcObject = this.mediaStream;

    // Wait for the video to be ready so we can read dimensions
    await new Promise<void>(resolve => {
      this.video.onloadedmetadata = () => resolve();
    });

    const w = this.video.videoWidth || 1920;
    const h = this.video.videoHeight || 1080;

    // Set up the canvas capture stream
    let canvasStream: MediaStream;

    if ("CanvasCaptureMediaStreamTrack" in window) {
      canvasStream = this.canvas.captureStream(0);
      this.canvasTrack = {
        synced: true,
        stream: canvasStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
      };
    } else {
      canvasStream = this.canvas.captureStream(TIMELAPSE_FPS / TIMELAPSE_FACTOR);
      this.canvasTrack = {
        synced: false,
        stream: canvasStream.getVideoTracks()[0]!
      };
    }

    // Create the MediaRecorder on the canvas stream
    const bitrate = w * h * BITS_PER_PIXEL;
    console.log(`(mediaSession.ts) bitrate=${bitrate} (${Math.floor(bitrate / 1000)}kbit/s)`);

    this.recorder = new MediaRecorder(canvasStream, {
      videoBitsPerSecond: bitrate,
      audioBitsPerSecond: 0
    });

    this.recorder.ondataavailable = (ev: BlobEvent) => {
      this.handleRecorderData(ev);
    };

    this.recorder.start(CAPTURE_INTERVAL_MS);
    this.intervalId = this.setFrameInterval();
  }

  /**
   * Stops recording and releases all resources.
   * Returns a promise that resolves once the recorder has flushed.
   */
  stop(): Promise<void> {
    return new Promise<void>(resolve => {
      if (this.intervalId != null) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }

      if (!this.recorder || this.recorder.state === "inactive") {
        this.cleanup();
        window.captureApi.sendStopped();
        resolve();
        return;
      }

      this.recorder.onstop = () => {
        this.cleanup();
        window.captureApi.sendStopped();
        resolve();
      };

      this.recorder.stop();
    });
  }

  /**
   * Pauses the frame capture loop and MediaRecorder.
   */
  pause(): void {
    this.isPaused = true;

    if (this.intervalId != null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.recorder && this.recorder.state === "recording") {
      this.recorder.pause();
    }
  }

  /**
   * Resumes frame capture and MediaRecorder.
   */
  resume(): void {
    this.isPaused = false;

    if (this.recorder && this.recorder.state === "paused") {
      this.recorder.resume();
    }

    this.intervalId = this.setFrameInterval();
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private setFrameInterval(): ReturnType<typeof setInterval> {
    return setInterval(() => {
      this.captureFrame();
    }, CAPTURE_INTERVAL_MS);
  }

  private captureFrame(): void {
    if (this.isPaused) return;

    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    if (w === 0 || h === 0) return;

    // Blit the live video onto the canvas
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvasCtx.drawImage(this.video, 0, 0);

    // If we have a synced canvas track, request a frame explicitly
    if (this.canvasTrack.synced) {
      this.canvasTrack.stream.requestFrame();
    }

    // Ensure the recorder is in a sane state
    if (this.recorder) {
      if (this.recorder.state === "inactive") {
        console.warn("(mediaSession.ts) MediaRecorder became inactive -- restarting");
        this.recorder.start(CAPTURE_INTERVAL_MS);
      } else if (this.recorder.state === "paused") {
        console.warn("(mediaSession.ts) MediaRecorder became paused -- resuming");
        this.recorder.resume();
      }

      this.recorder.requestData();
    }

    // Notify main process about the snapshot
    window.captureApi.sendSnapshot(Date.now());
  }

  private async handleRecorderData(ev: BlobEvent): Promise<void> {
    if (ev.data.size <= 0) {
      console.warn("(mediaSession.ts) ignoring empty video chunk");
      return;
    }

    const buffer = await ev.data.arrayBuffer();
    window.captureApi.sendChunk(buffer);
  }

  private cleanup(): void {
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }

    this.video.srcObject = null;
  }
}

// Export for use by captureWindow.ts
export { MediaSession };
