import { app, BrowserWindow, desktopCapturer, ipcMain } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CaptureStatus, DesktopSource } from "@/shared/ipc-channels";
import { storageService } from "../storage/deviceStorage";

/**
 * Manages the screen/webcam capture lifecycle for the desktop app.
 *
 * Uses a hidden BrowserWindow to run MediaRecorder (which requires a DOM
 * context). The hidden window receives chunks via IPC and this manager
 * persists them to disk through the storage service.
 */
class CaptureManager {
  private status: CaptureStatus = { state: "idle" };
  private captureWindow: BrowserWindow | null = null;
  private sessionId: number | null = null;
  private snapshotCount = 0;
  private sessionCount = 0;

  /**
   * Enumerates available screens and windows via Electron's desktopCapturer.
   */
  async getSources(): Promise<DesktopSource[]> {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 180 }
    });

    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnailDataUrl: source.thumbnail.toDataURL()
    }));
  }

  /**
   * Returns the current capture status.
   */
  getStatus(): CaptureStatus {
    return this.status;
  }

  /**
   * Starts a new capture session targeting the given source.
   */
  async startCapture(sourceId: string): Promise<void> {
    if (this.status.state !== "idle") {
      throw new Error(`Cannot start capture: current state is "${this.status.state}"`);
    }

    // Resolve source name
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
    const source = sources.find(s => s.id === sourceId);
    const sourceName = source?.name ?? "Unknown";

    // Ensure a timelapse exists in storage
    const existing = await storageService.getTimelapse();
    if (!existing) {
      await storageService.createTimelapse();
    }

    this.sessionId = Date.now();
    this.snapshotCount = 0;
    this.sessionCount = (existing?.sessions.length ?? 0) + 1;

    // Register IPC listeners for chunks and snapshots from the capture window
    this.registerCaptureIpc();

    // Create the hidden capture window
    const preloadPath = join(__dirname, "../preload/capturePreload.js");
    const captureScriptPath = join(__dirname, "captureWindow.js");

    this.captureWindow = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false // needed for desktopCapturer constraints
      }
    });

    // Load a minimal inline HTML page. The actual capture logic is loaded as
    // an external script from the built captureWindow.js bundle, with the
    // preload providing the IPC bridge.
    const captureScriptUrl = `file://${captureScriptPath.replace(/\\/g, "/")}`;
    const html = [
      "<!DOCTYPE html>",
      "<html><head><meta charset=\"UTF-8\">",
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' file:; media-src 'self' mediastream:;">`,
      "</head><body>",
      `<script src="${captureScriptUrl}"></script>`,
      "</body></html>"
    ].join("");

    // loadURL with a data URI does not allow file:// script src due to CSP.
    // Instead we write a temporary HTML file and load that.
    const tmpHtmlPath = join(app.getPath("temp"), "lapse-capture.html");
    await writeFile(tmpHtmlPath, html, "utf-8");
    this.captureWindow.loadFile(tmpHtmlPath);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Capture window failed to load within 10 seconds"));
      }, 10000);

      this.captureWindow!.webContents.once("did-finish-load", () => {
        clearTimeout(timeout);
        // Send the sourceId to the capture window so it can start recording
        this.captureWindow!.webContents.send("capture:init", sourceId);
        resolve();
      });
    });

    this.setStatus({
      state: "recording",
      sourceId,
      sourceName,
      startedAt: Date.now(),
      sessionCount: this.sessionCount,
      snapshotCount: this.snapshotCount
    });
  }

  /**
   * Stops the current capture session and tears down the hidden window.
   */
  async stopCapture(): Promise<void> {
    if (this.status.state === "idle") {
      return;
    }

    if (this.captureWindow && !this.captureWindow.isDestroyed()) {
      // Ask the capture window to stop gracefully
      this.captureWindow.webContents.send("capture:stop-recording");

      // Wait briefly for final chunks
      await new Promise<void>(resolve => {
        const onStopped = () => {
          ipcMain.removeListener("capture:stopped", onStopped);
          resolve();
        };

        ipcMain.once("capture:stopped", onStopped);

        // Fallback timeout -- don't wait forever
        setTimeout(() => {
          ipcMain.removeListener("capture:stopped", onStopped);
          resolve();
        }, 3000);
      });

      this.captureWindow.destroy();
      this.captureWindow = null;
    }

    this.unregisterCaptureIpc();
    this.sessionId = null;
    this.setStatus({ state: "idle" });
  }

  /**
   * Pauses the current capture session.
   */
  async pauseCapture(): Promise<void> {
    if (this.status.state !== "recording") {
      throw new Error(`Cannot pause: current state is "${this.status.state}"`);
    }

    if (this.captureWindow && !this.captureWindow.isDestroyed()) {
      this.captureWindow.webContents.send("capture:pause-recording");
    }

    this.setStatus({
      state: "paused",
      sourceId: this.status.sourceId,
      sourceName: this.status.sourceName,
      startedAt: this.status.startedAt,
      sessionCount: this.status.sessionCount,
      snapshotCount: this.status.snapshotCount
    });
  }

  /**
   * Resumes a paused capture session.
   */
  async resumeCapture(): Promise<void> {
    if (this.status.state !== "paused") {
      throw new Error(`Cannot resume: current state is "${this.status.state}"`);
    }

    if (this.captureWindow && !this.captureWindow.isDestroyed()) {
      this.captureWindow.webContents.send("capture:resume-recording");
    }

    this.setStatus({
      state: "recording",
      sourceId: this.status.sourceId,
      sourceName: this.status.sourceName,
      startedAt: this.status.startedAt,
      sessionCount: this.status.sessionCount,
      snapshotCount: this.status.snapshotCount
    });
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private chunkHandler = async (_event: Electron.IpcMainEvent, buffer: Buffer) => {
    if (this.sessionId == null) return;

    try {
      await storageService.appendChunk(this.sessionId, Buffer.from(buffer));
    } catch (err) {
      console.error("(captureManager.ts) failed to write chunk:", err);
    }
  };

  private snapshotHandler = (_event: Electron.IpcMainEvent, timestamp: number) => {
    this.snapshotCount++;

    // Persist the snapshot timestamp
    storageService.appendSnapshot(timestamp).catch(err => {
      console.error("(captureManager.ts) failed to write snapshot:", err);
    });

    // Update status with new snapshot count and broadcast
    if (this.status.state === "recording" || this.status.state === "paused") {
      this.setStatus({
        ...this.status,
        snapshotCount: this.snapshotCount
      });
    }

    // Notify renderers about the individual snapshot
    this.broadcastEvent("capture:snapshot", { timestamp });
  };

  private stoppedHandler = () => {
    // Handled by the stopCapture await
  };

  private registerCaptureIpc() {
    ipcMain.on("capture:chunk", this.chunkHandler);
    ipcMain.on("capture:snapshot-taken", this.snapshotHandler);
    ipcMain.on("capture:stopped", this.stoppedHandler);
  }

  private unregisterCaptureIpc() {
    ipcMain.removeListener("capture:chunk", this.chunkHandler);
    ipcMain.removeListener("capture:snapshot-taken", this.snapshotHandler);
    ipcMain.removeListener("capture:stopped", this.stoppedHandler);
  }

  /**
   * Updates the internal status and broadcasts the change to all renderer
   * windows.
   */
  private setStatus(newStatus: CaptureStatus) {
    this.status = newStatus;
    this.broadcastEvent("capture:status-changed", newStatus);
  }

  /**
   * Sends an event to every open BrowserWindow.
   */
  private broadcastEvent<T>(channel: string, data: T) {
    for (const win of BrowserWindow.getAllWindows()) {
      // Don't send to the hidden capture window
      if (win === this.captureWindow) continue;
      if (win.isDestroyed()) continue;

      win.webContents.send(channel, data);
    }
  }
}

export const captureManager = new CaptureManager();
