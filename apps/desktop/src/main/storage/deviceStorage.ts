import * as fs from "node:fs/promises";
import * as path from "node:path";
import { app } from "electron";
import { ascending } from "@hackclub/lapse-shared";

/**
 * The metadata about a stored timelapse. This does *not* include the actual
 * video -- invoke `storageService.getTimelapseVideoSessions` for that.
 */
export interface StoredTimelapse {
  startedAt: number;
  snapshots: number[];
  sessions: number[];
}

/**
 * A device with an associated passkey.
 */
export interface LocalDevice {
  id: string;
  passkey: string;
  legacyPasskey?: string;
  thisDevice: boolean;
}

/**
 * Collection of locally stored devices.
 */
export type LocalDevices = LocalDevice[];

interface Store {
  devices: LocalDevice[];
  timelapse: StoredTimelapse | null;
}

class AsyncQueue {
  private currentTask: Promise<unknown> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const promise = this.currentTask.then(() => task());
    this.currentTask = promise.then(
      () => {},
      () => {}
    );
    return promise;
  }

  async synchronize(): Promise<void> {
    return this.enqueue(async () => {});
  }
}

function getStorageDir(): string {
  return path.join(app.getPath("userData"), "lapse");
}

function getStorePath(): string {
  return path.join(getStorageDir(), "store.json");
}

function sessionFileName(sessionId: number): string {
  return `session-${sessionId}.webm`;
}

function sessionFilePath(sessionId: number): string {
  return path.join(getStorageDir(), sessionFileName(sessionId));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Securely stores data on the local filesystem, mirroring the web client's
 * OPFS-based DeviceStorage but using Node.js `fs.promises`.
 */
class DeviceStorage {
  private initialized = false;
  private serialQueue = new AsyncQueue();

  private async ensureInit(): Promise<void> {
    if (this.initialized) return;

    const dir = getStorageDir();
    await fs.mkdir(dir, { recursive: true });

    const storePath = getStorePath();
    if (!(await fileExists(storePath))) {
      console.log("(deviceStorage.ts) no store found -- creating a new one");
      await this.writeStore({ devices: [], timelapse: null });
    } else {
      console.log("(deviceStorage.ts) existing store found");
    }

    this.initialized = true;
  }

  private async readStore(): Promise<Store> {
    await this.ensureInit();

    const storePath = getStorePath();
    const contents = await fs.readFile(storePath, "utf-8");

    try {
      const parsed = JSON.parse(contents) as Store;
      return parsed;
    } catch (err) {
      console.error(`(deviceStorage.ts) JSON store corrupted -- rebuilding! ${contents}`, err);

      let restored: Record<string, unknown> = {};
      try {
        // Attempt to repair the JSON using jsonrepair if available
        const { jsonrepair } = await import("jsonrepair");
        restored = JSON.parse(jsonrepair(contents)) as Record<string, unknown>;
      } catch (repairErr) {
        console.warn("(deviceStorage.ts) could not restore JSON -- will rebuild completely", repairErr);
      }

      function tryGet<T>(keys: string[], defaultValue: T, coalesce: (x: unknown) => T): T {
        let current: unknown = restored;
        for (const key of keys) {
          if (
            current == null ||
            (typeof current !== "object" && typeof current !== "function") ||
            !(key in (current as Record<string, unknown>))
          ) {
            return defaultValue;
          }
          current = (current as Record<string, unknown>)[key];
        }
        return coalesce(current);
      }

      const devices = tryGet(["devices"], [] as LocalDevice[], x => {
        if (!Array.isArray(x)) return [];
        return x.filter((d: unknown) => {
          if (d == null || typeof d !== "object") return false;
          return "thisDevice" in d && (d as Record<string, unknown>).thisDevice;
        }) as LocalDevice[];
      });

      const snapshots = tryGet(["timelapse", "snapshots"], [] as number[], x => {
        if (Array.isArray(x)) return x.map(v => (typeof v === "number" ? v : Number(v)));
        return [];
      });

      const startedAt = tryGet(["timelapse", "startedAt"], Date.now(), x => {
        return typeof x === "number" ? x : Number(x);
      });

      // Rebuild sessions list from directory listing
      const sessions: number[] = [];
      const dir = getStorageDir();
      try {
        const entries = await fs.readdir(dir);
        for (const filename of entries) {
          const match = /^session-([0-9]+)\.webm$/.exec(filename);
          if (!match) {
            console.log(`(deviceStorage.ts) ignoring file ${filename} for session restore`);
            continue;
          }
          console.log(`(deviceStorage.ts) session found for restore: ${filename} (ID ${match[1]})`);
          sessions.push(parseInt(match[1]!, 10));
        }
      } catch (dirErr) {
        console.warn("(deviceStorage.ts) could not list storage directory for session restore", dirErr);
      }

      if (sessions.length === 0) {
        console.warn("(deviceStorage.ts) no sessions found while restoring timelapse");
        const store: Store = { devices, timelapse: null };
        await this.writeStore(store);
        return store;
      }

      sessions.sort(ascending());

      console.log("(deviceStorage.ts) existing timelapse successfully recovered from corrupted JSON!");
      console.log("(deviceStorage.ts) recovery payload:", devices, snapshots, startedAt, sessions);

      const data: Store = {
        devices,
        timelapse: { snapshots, startedAt, sessions }
      };

      await this.writeStore(data);
      return data;
    }
  }

  private async writeStore(data: Store): Promise<void> {
    const storePath = getStorePath();
    await fs.writeFile(storePath, JSON.stringify(data), "utf-8");
  }

  private async operation<T>(block: () => Promise<T>): Promise<T> {
    return await this.serialQueue.enqueue(async () => {
      return await block();
    });
  }

  /**
   * Returns the storage directory path.
   */
  getStoragePath(): string {
    return getStorageDir();
  }

  /**
   * Creates a new timelapse entry.
   */
  async createTimelapse(): Promise<StoredTimelapse> {
    return await this.operation(async () => {
      const store = await this.readStore();
      store.timelapse = {
        startedAt: Date.now(),
        snapshots: [],
        sessions: []
      };

      await this.writeStore(store);
      console.log("(deviceStorage.ts) timelapse created:", store.timelapse);
      return store.timelapse;
    });
  }

  /**
   * Gets the current timelapse metadata, or `null` if none exists.
   */
  async getTimelapse(): Promise<StoredTimelapse | null> {
    return await this.operation(async () => {
      const store = await this.readStore();
      return store.timelapse ?? null;
    });
  }

  /**
   * Deletes the current timelapse and all associated session files.
   */
  async deleteTimelapse(): Promise<void> {
    return await this.operation(async () => {
      const store = await this.readStore();
      const sessions = store.timelapse?.sessions ?? [];
      store.timelapse = null;
      await this.writeStore(store);

      for (const sessionId of sessions) {
        try {
          await fs.unlink(sessionFilePath(sessionId));
        } catch (err) {
          console.warn(`(deviceStorage.ts) could not delete session ${sessionId}`, err);
        }
      }

      console.log("(deviceStorage.ts) locally stored timelapse deleted");
    });
  }

  /**
   * Appends a chunk of data to a session file. If the session is new, it is
   * registered in the store's sessions array.
   */
  async appendChunk(sessionId: number, data: Buffer): Promise<void> {
    console.debug(`(deviceStorage.ts) appendChunk(${sessionId}) -> ${data.length} bytes`);

    return await this.operation(async () => {
      const store = await this.readStore();
      if (!store.timelapse) {
        console.warn("(deviceStorage.ts) attempted to call appendChunk, but no timelapse is registered!");
        return;
      }

      if (!store.timelapse.sessions.includes(sessionId)) {
        store.timelapse.sessions.push(sessionId);
        await this.writeStore(store);
      }

      const filePath = sessionFilePath(sessionId);
      await fs.appendFile(filePath, data);
    });
  }

  /**
   * Appends a snapshot timestamp to the current timelapse.
   */
  async appendSnapshot(timestamp: number): Promise<void> {
    return await this.operation(async () => {
      const store = await this.readStore();
      if (!store.timelapse) return;

      store.timelapse.snapshots.push(timestamp);
      await this.writeStore(store);

      console.debug("(deviceStorage.ts) appendSnapshot ->", timestamp);
    });
  }

  /**
   * Returns all session file paths and their contents as Buffers.
   */
  async getTimelapseVideoSessions(): Promise<{ sessionId: number; filePath: string; data: Buffer }[]> {
    return await this.operation(async () => {
      const store = await this.readStore();
      if (!store.timelapse) return [];

      const results: { sessionId: number; filePath: string; data: Buffer }[] = [];

      for (const sessionId of store.timelapse.sessions) {
        const fp = sessionFilePath(sessionId);
        try {
          const data = await fs.readFile(fp);
          results.push({ sessionId, filePath: fp, data });
        } catch (err) {
          console.warn(`(deviceStorage.ts) could not read session ${sessionId} -- skipping`, err);
        }
      }

      return results;
    });
  }

  /**
   * Returns the total size (in bytes) of all session files.
   */
  async getTimelapseVideoSize(): Promise<number> {
    return await this.operation(async () => {
      const store = await this.readStore();
      if (!store.timelapse) return 0;

      let totalSize = 0;

      for (const sessionId of store.timelapse.sessions) {
        try {
          const stat = await fs.stat(sessionFilePath(sessionId));
          totalSize += stat.size;
        } catch (err) {
          console.warn(`(deviceStorage.ts) could not read session ${sessionId} size -- skipping`, err);
        }
      }

      return totalSize;
    });
  }

  /**
   * Saves or updates a device in the local store.
   */
  async saveDevice(device: LocalDevice): Promise<string> {
    return await this.operation(async () => {
      const store = await this.readStore();
      const existingIndex = store.devices.findIndex(d => d.id === device.id);

      if (existingIndex >= 0) {
        store.devices[existingIndex] = device;
      } else {
        store.devices.push(device);
      }

      await this.writeStore(store);
      console.log("(deviceStorage.ts) saveDevice ->", device);
      return device.id;
    });
  }

  /**
   * Gets a device by ID, or `null` if not found.
   */
  async getDevice(id: string): Promise<LocalDevice | null> {
    return await this.operation(async () => {
      const store = await this.readStore();
      return store.devices.find(d => d.id === id) ?? null;
    });
  }

  /**
   * Gets all locally stored devices.
   */
  async getAllDevices(): Promise<LocalDevices> {
    return await this.operation(async () => {
      const store = await this.readStore();
      return store.devices;
    });
  }

  /**
   * Deletes a device by ID.
   */
  async deleteDevice(id: string): Promise<void> {
    return await this.operation(async () => {
      const store = await this.readStore();
      store.devices = store.devices.filter(d => d.id !== id);
      await this.writeStore(store);
      console.log(`(deviceStorage.ts) deleteDevice(${id})`);
    });
  }

  /**
   * Ensures all pending storage operations are complete.
   */
  async sync(): Promise<void> {
    await this.serialQueue.synchronize();
    console.log("(deviceStorage.ts) device storage has been synchronized");
  }
}

/**
 * Singleton storage service instance.
 */
export const storageService = new DeviceStorage();

/**
 * Initializes the storage service. Must be called once at app startup
 * (before any storage operations).
 */
export async function initStorageService(): Promise<void> {
  const dir = getStorageDir();
  await fs.mkdir(dir, { recursive: true });

  const storePath = getStorePath();
  if (!(await fileExists(storePath))) {
    await fs.writeFile(storePath, JSON.stringify({ devices: [], timelapse: null }), "utf-8");
    console.log("(deviceStorage.ts) initialized new store at", storePath);
  } else {
    console.log("(deviceStorage.ts) store already exists at", storePath);
  }
}
