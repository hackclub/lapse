import { app, BrowserWindow, protocol } from "electron";
import { join } from "node:path";
import { createTray } from "./tray";
import { createMainWindow } from "./windowManager";
import { registerIpcHandlers } from "./ipc/index";
import { initAutoUpdater } from "./updater";
import { initStorageService } from "./storage/deviceStorage";
import { authService } from "./auth/oauthFlow";

// Enforce single instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

app.on("second-instance", (_event, argv) => {
  // On Windows/Linux, the deep link URL is in argv
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }

  // Handle lapse:// protocol callback from argv
  const url = argv.find(arg => arg.startsWith("lapse://"));
  if (url) {
    authService.handleCallback(url);
  }
});

// Register lapse:// protocol for OAuth callbacks
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("lapse", process.execPath, [
      "--", process.argv[1]!
    ]);
  }
} else {
  app.setAsDefaultProtocolClient("lapse");
}

// macOS: handle open-url event for deep links
app.on("open-url", (_event, url) => {
  if (url.startsWith("lapse://")) {
    authService.handleCallback(url);
  }
});

app.whenReady().then(async () => {
  // Initialize storage directory
  await initStorageService();

  // Load persisted auth token
  await authService.initialize();

  // Register IPC handlers before creating windows
  registerIpcHandlers();

  // Create main window
  mainWindow = createMainWindow();

  // Create system tray
  createTray(mainWindow);

  // Initialize auto-updater
  initAutoUpdater(mainWindow);

  app.on("activate", () => {
    // macOS: re-create window when dock icon clicked and no windows open
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // On macOS, keep app running in tray when all windows closed
  if (process.platform !== "darwin") {
    // On Windows/Linux, keep running in tray too (don't quit)
  }
});
