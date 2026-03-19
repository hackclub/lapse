// Shared type definitions used across main and renderer processes.

export interface TimelapseSession {
  id: string;
  filePath: string;
  resolution: { width: number; height: number };
  startedAt: number;
}

export interface StoreData {
  currentTimelapse: {
    id: string;
    sessions: string[];
    snapshots: number[];
    startedAt: number;
  } | null;
  devices: Array<{
    id: string;
    passkey: string;
    label: string;
  }>;
}

export interface AppSettings {
  serverUrl: string;
  storagePath: string;
  autoStartOnLogin: boolean;
  notificationsEnabled: boolean;
  captureQuality: "low" | "medium" | "high";
}

export const DEFAULT_SETTINGS: AppSettings = {
  serverUrl: "https://lapse.hackclub.com",
  storagePath: "",
  autoStartOnLogin: false,
  notificationsEnabled: true,
  captureQuality: "medium"
};

// Timelapse timing constants (matching web client)
export const TIMELAPSE_FACTOR = 60;
export const TIMELAPSE_FPS = 24;
export const CAPTURE_INTERVAL_MS = (1000 * TIMELAPSE_FACTOR) / TIMELAPSE_FPS; // ~2500ms
export const BITS_PER_PIXEL = 48;
export const MIN_SESSION_SIZE_BYTES = 4096;
export const MAX_VIDEO_FRAME_COUNT = 86400;
