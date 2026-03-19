import * as fs from "node:fs";
import * as path from "node:path";
import { BrowserWindow } from "electron";
import * as tus from "tus-js-client";
import { MIN_SESSION_SIZE_BYTES, fromHex } from "@hackclub/lapse-shared";

import { storageService } from "./deviceStorage";
import { encryptData } from "./encryption";

/**
 * The retry delays used by tus-js-client, matching the web client.
 */
const TUS_RETRY_DELAYS = [0, 3000, 5000, 10000, 20000];

/**
 * The base API URL for uploads.
 */
const API_URL = "https://api.lapse.hackclub.com";

interface ActiveUpload {
  tusUpload: tus.Upload | null;
  cancelled: boolean;
}

/**
 * Handles the encrypt-and-upload flow for publishing timelapses from the
 * desktop app. Reads session files from local storage, encrypts each one,
 * and uploads via tus-js-client to the server.
 */
class UploadPipeline {
  private active: ActiveUpload | null = null;

  /**
   * Starts the full upload pipeline: sync storage, read sessions, encrypt,
   * upload, and send progress/completion/error events to the renderer.
   */
  async startUpload(win: BrowserWindow): Promise<{ draftId: string }> {
    if (this.active) {
      throw new Error("An upload is already in progress");
    }

    this.active = { tusUpload: null, cancelled: false };

    try {
      // 1. Sync any pending writes
      await storageService.sync();

      // 2. Read all sessions and timelapse metadata
      const sessions = (await storageService.getTimelapseVideoSessions())
        .filter(s => s.data.length > MIN_SESSION_SIZE_BYTES);
      const timelapse = await storageService.getTimelapse();

      if (!timelapse || sessions.length === 0) {
        throw new Error("No local timelapse or no sessions have been captured");
      }

      // 3. Get the current device (the one marked as thisDevice)
      const devices = await storageService.getAllDevices();
      const device = devices.find(d => d.thisDevice);

      if (!device) {
        throw new Error("No device registered as thisDevice -- cannot encrypt");
      }

      // 4. Create a draft timelapse on the server
      // We import the auth token getter dynamically to avoid circular deps
      const token = await this.getAuthToken();
      if (!token) {
        throw new Error("Not authenticated -- cannot upload");
      }

      const draftRes = await fetch(`${API_URL}/api/draft-timelapse/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          snapshots: timelapse.snapshots,
          thumbnailSize: 0, // desktop does not generate thumbnails yet
          deviceId: device.id,
          sessions: sessions.map(s => ({ fileSize: s.data.length + 8192 }))
        })
      });

      if (!draftRes.ok) {
        const body = await draftRes.text();
        throw new Error(`Server returned ${draftRes.status}: ${body}`);
      }

      const draft = (await draftRes.json()) as {
        data: {
          draftTimelapse: { id: string; iv: string };
          sessionUploadTokens: string[];
          thumbnailUploadToken: string;
        };
      };

      const draftId = draft.data.draftTimelapse.id;
      const iv = fromHex(draft.data.draftTimelapse.iv);
      const key = fromHex(device.passkey);

      // 5. Encrypt and upload each session
      for (let i = 0; i < sessions.length; i++) {
        if (this.active.cancelled) {
          throw new Error("Upload cancelled");
        }

        const session = sessions[i]!;
        const uploadToken = draft.data.sessionUploadTokens[i]!;

        // Encrypt
        win.webContents.send("upload:progress", {
          sessionId: String(session.sessionId),
          bytesUploaded: 0,
          bytesTotal: session.data.length
        });

        const encrypted = await encryptData(
          key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength),
          iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength),
          session.data
        );

        const encryptedBuffer = Buffer.from(encrypted);

        // Upload via tus
        if (this.active.cancelled) {
          throw new Error("Upload cancelled");
        }

        await this.tusUpload(
          win,
          encryptedBuffer,
          uploadToken,
          String(session.sessionId)
        );
      }

      // 6. Clean up local data
      await storageService.deleteTimelapse();

      // 7. Notify renderer of completion
      win.webContents.send("upload:complete", { draftId });

      this.active = null;
      return { draftId };
    } catch (err) {
      const message = err instanceof Error ? err.message : "An unknown error occurred during upload";

      if (this.active && !this.active.cancelled) {
        try {
          win.webContents.send("upload:error", { message });
        } catch {
          // Window may have been destroyed
        }
      }

      this.active = null;
      throw err;
    }
  }

  /**
   * Cancels any in-progress upload.
   */
  cancelUpload(): void {
    if (!this.active) return;

    this.active.cancelled = true;
    if (this.active.tusUpload) {
      this.active.tusUpload.abort(true);
    }
  }

  /**
   * Performs a single tus upload of the given buffer.
   */
  private tusUpload(
    win: BrowserWindow,
    data: Buffer,
    token: string,
    sessionId: string
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(
        new Blob([new Uint8Array(data)], { type: "video/webm" }),
        {
          endpoint: `${API_URL}/upload`,
          retryDelays: TUS_RETRY_DELAYS,
          headers: {
            authorization: `Bearer ${token}`
          },
          onProgress: (bytesUploaded: number, bytesTotal: number) => {
            try {
              win.webContents.send("upload:progress", {
                sessionId,
                bytesUploaded,
                bytesTotal
              });
            } catch {
              // Window may have been destroyed
            }
          },
          onSuccess: () => {
            resolve();
          },
          onError: (error: Error) => {
            console.error(`(uploadPipeline.ts) tus upload failed for session ${sessionId}:`, error);
            reject(error);
          }
        }
      );

      if (this.active) {
        this.active.tusUpload = upload;
      }

      upload.start();
    });
  }

  /**
   * Retrieves the current auth token. This is a simple helper that uses
   * ipcMain's handler indirectly -- we read it from the auth service.
   */
  private async getAuthToken(): Promise<string | null> {
    try {
      // Dynamic import to avoid circular dependency issues at module load time
      const { authService } = await import("../auth/oauthFlow");
      return authService.getToken();
    } catch {
      console.warn("(uploadPipeline.ts) could not import authService -- auth module may not exist yet");
      return null;
    }
  }
}

/**
 * Singleton upload pipeline instance.
 */
export const uploadPipeline = new UploadPipeline();
