import { contextBridge, ipcRenderer } from "electron";

/**
 * Minimal preload script for the hidden capture BrowserWindow.
 *
 * Exposes only the IPC channels needed for capture -- the capture window
 * does NOT get the full `window.lapse` API.
 */
const captureApi = {
  /** Send a recorded video chunk (as an ArrayBuffer) to the main process. */
  sendChunk(buffer: ArrayBuffer): void {
    ipcRenderer.send("capture:chunk", Buffer.from(buffer));
  },

  /** Notify the main process that a snapshot (frame) was captured. */
  sendSnapshot(timestamp: number): void {
    ipcRenderer.send("capture:snapshot-taken", timestamp);
  },

  /** Notify the main process that the MediaRecorder has fully stopped. */
  sendStopped(): void {
    ipcRenderer.send("capture:stopped");
  },

  /** Listen for the initial sourceId from the main process. */
  onInit(callback: (sourceId: string) => void): void {
    ipcRenderer.on("capture:init", (_event, sourceId: string) => {
      callback(sourceId);
    });
  },

  /** Listen for a stop command from the main process. */
  onStop(callback: () => void): void {
    ipcRenderer.on("capture:stop-recording", () => {
      callback();
    });
  },

  /** Listen for a pause command from the main process. */
  onPause(callback: () => void): void {
    ipcRenderer.on("capture:pause-recording", () => {
      callback();
    });
  },

  /** Listen for a resume command from the main process. */
  onResume(callback: () => void): void {
    ipcRenderer.on("capture:resume-recording", () => {
      callback();
    });
  }
};

contextBridge.exposeInMainWorld("captureApi", captureApi);

export type CaptureApi = typeof captureApi;
