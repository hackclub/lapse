import { ipcMain, BrowserWindow } from "electron";
import { uploadPipeline } from "../storage/uploadPipeline";

export function registerUploadHandlers() {
  ipcMain.handle("upload:start", async event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error("No window found");

    return uploadPipeline.startUpload(win);
  });

  ipcMain.handle("upload:cancel", async () => {
    return uploadPipeline.cancelUpload();
  });
}
