import type { LapseApi } from "@/preload/index";

// Typed access to the IPC bridge exposed by the preload script
declare global {
  interface Window {
    lapse: LapseApi;
  }
}

export const lapse = window.lapse;
