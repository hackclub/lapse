// Single source of truth for all IPC channel names and their type signatures.
// Imported by both main process and preload script to ensure type safety.

export interface DesktopSource {
  id: string;
  name: string;
  thumbnailDataUrl: string;
}

export type CaptureStatus = {
  state: "idle";
} | {
  state: "recording";
  sourceId: string;
  sourceName: string;
  startedAt: number;
  sessionCount: number;
  snapshotCount: number;
} | {
  state: "paused";
  sourceId: string;
  sourceName: string;
  startedAt: number;
  sessionCount: number;
  snapshotCount: number;
};

export interface StoredTimelapse {
  sessions: number[];
  snapshots: number[];
  startedAt: number;
}

export interface LocalDevice {
  id: string;
  passkey: string;
  label: string;
}

export interface UploadProgress {
  sessionId: string;
  bytesUploaded: number;
  bytesTotal: number;
}

export interface UpdateCheckResult {
  available: boolean;
  version?: string;
}

// Request-response channels (ipcMain.handle / ipcRenderer.invoke)
export type IpcChannelMap = {
  // Auth
  "auth:login": { args: []; result: { success: boolean } };
  "auth:logout": { args: []; result: void };
  "auth:get-token": { args: []; result: string | null };
  "auth:set-token": { args: [token: string]; result: { success: boolean } };
  "auth:get-user": { args: []; result: { id: string; handle: string; displayName: string | null; pictureUrl: string | null } | null };

  // Capture
  "capture:get-sources": { args: []; result: DesktopSource[] };
  "capture:start": { args: [sourceId: string]; result: void };
  "capture:stop": { args: []; result: void };
  "capture:pause": { args: []; result: void };
  "capture:resume": { args: []; result: void };
  "capture:status": { args: []; result: CaptureStatus };

  // Storage
  "storage:get-timelapse": { args: []; result: StoredTimelapse | null };
  "storage:get-devices": { args: []; result: LocalDevice[] };
  "storage:save-device": { args: [device: LocalDevice]; result: string };
  "storage:get-video-size": { args: []; result: number };
  "storage:delete-timelapse": { args: []; result: void };

  // API proxy
  "api:call": { args: [path: string, input: unknown]; result: unknown };

  // Upload
  "upload:start": { args: []; result: { draftId: string } };
  "upload:cancel": { args: []; result: void };

  // App
  "app:get-version": { args: []; result: string };
  "app:check-updates": { args: []; result: UpdateCheckResult };
  "app:open-dashboard": { args: []; result: void };
  "app:quit": { args: []; result: void };
  "app:get-storage-path": { args: []; result: string };
};

// Push event channels (main -> renderer via webContents.send)
export type IpcEventMap = {
  "capture:status-changed": CaptureStatus;
  "capture:snapshot": { timestamp: number };
  "upload:progress": UploadProgress;
  "upload:complete": { draftId: string };
  "upload:error": { message: string };
  "app:update-available": { version: string };
};

// Helper types for extracting channel keys
export type IpcChannel = keyof IpcChannelMap;
export type IpcEvent = keyof IpcEventMap;
