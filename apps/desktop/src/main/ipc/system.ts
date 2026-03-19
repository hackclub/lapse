import { ipcMain, app } from "electron";
import { checkForUpdates } from "../updater";
import { storageService } from "../storage/deviceStorage";

export function registerSystemHandlers() {
  ipcMain.handle("app:get-version", () => {
    return app.getVersion();
  });

  ipcMain.handle("app:check-updates", async () => {
    try {
      const result = await checkForUpdates();
      return {
        available: !!result?.updateInfo,
        version: result?.updateInfo?.version
      };
    } catch {
      return { available: false };
    }
  });

  ipcMain.handle("app:open-dashboard", () => {
    // Handled by renderer navigation — this is a no-op placeholder
  });

  ipcMain.handle("app:quit", () => {
    app.quit();
  });

  ipcMain.handle("app:get-storage-path", () => {
    return storageService.getStoragePath();
  });
}
