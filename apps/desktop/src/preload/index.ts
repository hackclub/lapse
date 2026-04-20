import { contextBridge, ipcRenderer } from "electron";
import type { IpcChannelMap, IpcEventMap, IpcChannel, IpcEvent } from "@/shared/ipc-channels";

// Type-safe IPC bridge exposed to the renderer as window.lapse
const api = {
  invoke: <K extends IpcChannel>(
    channel: K,
    ...args: IpcChannelMap[K]["args"]
  ): Promise<IpcChannelMap[K]["result"]> => {
    return ipcRenderer.invoke(channel, ...args);
  },

  on: <K extends IpcEvent>(
    channel: K,
    callback: (data: IpcEventMap[K]) => void
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: IpcEventMap[K]) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },

  once: <K extends IpcEvent>(
    channel: K,
    callback: (data: IpcEventMap[K]) => void
  ): void => {
    ipcRenderer.once(channel, (_event, data) => callback(data));
  }
};

contextBridge.exposeInMainWorld("lapse", api);

// Export the type for use in renderer
export type LapseApi = typeof api;
