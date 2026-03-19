import { Tray, Menu, nativeImage, BrowserWindow } from "electron";
import { join } from "node:path";
import type { CaptureStatus } from "@/shared/ipc-channels";

let tray: Tray | null = null;
let currentStatus: CaptureStatus = { state: "idle" };

export function createTray(mainWindow: BrowserWindow): Tray {
  // Use a simple 16x16 icon — placeholder until real icons are provided
  const iconPath = join(__dirname, "../../build/icon.ico");
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  tray.setToolTip("Lapse");
  updateTrayMenu(mainWindow);

  tray.on("click", () => {
    if (mainWindow.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow.show();
    }
  });

  return tray;
}

export function updateTrayStatus(status: CaptureStatus, mainWindow: BrowserWindow) {
  currentStatus = status;
  updateTrayMenu(mainWindow);

  if (tray) {
    switch (status.state) {
      case "recording":
        tray.setToolTip(`Lapse — Recording (${status.sourceName})`);
        break;
      case "paused":
        tray.setToolTip("Lapse — Paused");
        break;
      default:
        tray.setToolTip("Lapse");
    }
  }
}

function updateTrayMenu(mainWindow: BrowserWindow) {
  const statusLabel = currentStatus.state === "recording"
    ? `Recording: ${formatDuration(Date.now() - currentStatus.startedAt)}`
    : currentStatus.state === "paused"
      ? "Paused"
      : "Idle";

  const contextMenu = Menu.buildFromTemplate([
    { label: statusLabel, enabled: false },
    { type: "separator" },
    ...(currentStatus.state === "idle" ? [
      {
        label: "Open Lapse",
        click: () => {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    ] : []),
    ...(currentStatus.state === "recording" ? [
      {
        label: "Pause Recording",
        click: () => mainWindow.webContents.send("tray:pause")
      },
      {
        label: "Stop Recording",
        click: () => mainWindow.webContents.send("tray:stop")
      }
    ] : []),
    ...(currentStatus.state === "paused" ? [
      {
        label: "Resume Recording",
        click: () => mainWindow.webContents.send("tray:resume")
      },
      {
        label: "Stop Recording",
        click: () => mainWindow.webContents.send("tray:stop")
      }
    ] : []),
    { type: "separator" as const },
    {
      label: "Open Dashboard",
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    { type: "separator" as const },
    {
      label: "Quit Lapse",
      click: () => {
        mainWindow.destroy();
        require("electron").app.quit();
      }
    }
  ]);

  tray?.setContextMenu(contextMenu);
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m ${seconds % 60}s`;
}
