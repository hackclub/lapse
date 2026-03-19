import { ipcMain } from "electron";
import { storageService } from "../storage/deviceStorage";

export function registerStorageHandlers() {
  ipcMain.handle("storage:get-timelapse", async () => {
    return storageService.getTimelapse();
  });

  ipcMain.handle("storage:get-devices", async () => {
    return storageService.getAllDevices();
  });

  ipcMain.handle("storage:save-device", async (_event, device) => {
    return storageService.saveDevice(device);
  });

  ipcMain.handle("storage:get-video-size", async () => {
    return storageService.getTimelapseVideoSize();
  });

  ipcMain.handle("storage:delete-timelapse", async () => {
    return storageService.deleteTimelapse();
  });
}
