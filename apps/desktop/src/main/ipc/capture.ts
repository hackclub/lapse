import { ipcMain } from "electron";
import { captureManager } from "../capture/captureManager";

export function registerCaptureHandlers() {
  ipcMain.handle("capture:get-sources", async () => {
    return captureManager.getSources();
  });

  ipcMain.handle("capture:start", async (_event, sourceId: string) => {
    return captureManager.startCapture(sourceId);
  });

  ipcMain.handle("capture:stop", async () => {
    return captureManager.stopCapture();
  });

  ipcMain.handle("capture:pause", async () => {
    return captureManager.pauseCapture();
  });

  ipcMain.handle("capture:resume", async () => {
    return captureManager.resumeCapture();
  });

  ipcMain.handle("capture:status", async () => {
    return captureManager.getStatus();
  });
}
