import { autoUpdater } from "electron-updater";
import { BrowserWindow, dialog, Notification } from "electron";

export function initAutoUpdater(mainWindow: BrowserWindow) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", info => {
    mainWindow.webContents.send("app:update-available", {
      version: info.version
    });

    if (Notification.isSupported()) {
      const notification = new Notification({
        title: "Lapse Update Available",
        body: `Version ${info.version} is available. Click to download.`
      });

      notification.on("click", () => {
        autoUpdater.downloadUpdate();
      });

      notification.show();
    }
  });

  autoUpdater.on("update-downloaded", () => {
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Update Ready",
      message: "A new version of Lapse has been downloaded. Restart now to install?",
      buttons: ["Restart", "Later"]
    }).then(result => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on("error", error => {
    console.error("Auto-updater error:", error);
  });

  // Check for updates on startup (silently)
  autoUpdater.checkForUpdates().catch(() => {
    // Silently fail — user can manually check later
  });
}

export function checkForUpdates() {
  return autoUpdater.checkForUpdates();
}
