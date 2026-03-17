import * as v from "valibot";
import { jsonrepair } from "jsonrepair";

import { hasLegacyData } from "@/pages/migrate";
import { sleep } from "@/common";
import posthog from "posthog-js";

/**
 * The metadata about a stored timelapse. This does *not* include the actual video - invoke `deviceStorage.getTimelapseVideoSessions` for this.
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

export type LocalTimelapse = v.InferInput<typeof LocalTimelapseSchema>;
const LocalTimelapseSchema = v.object({
  startedAt: v.number(),
  snapshots: v.array(v.number()),
  sessions: v.array(v.number())
});

const DeviceSchema = v.object({
  id: v.string(),
  passkey: v.string(),
  legacyPasskey: v.optional(v.string()),
  thisDevice: v.boolean(),
});

type Store = v.InferOutput<typeof StoreSchema>;
const StoreSchema = v.object({
  devices: v.array(DeviceSchema),
  timelapse: v.nullable(LocalTimelapseSchema),
});

class AsyncQueue {
  private currentTask: Promise<unknown> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const promise = this.currentTask.then(() => task());
    this.currentTask = promise.then(
      () => { },
      () => { }
    );
    return promise;
  }

  async synchronize(): Promise<void> {
    return this.enqueue(async () => { });
  }
}

async function doesFileExist(directoryHandle: FileSystemDirectoryHandle, fileName: string) {
  for await (const entry of directoryHandle.values()) {
    if (entry.kind === "file" && entry.name === fileName) {
      return true;
    }
  }

  return false;
}


/**
 * Securely stores data on the client device.
 */
export class DeviceStorage {
  private root: FileSystemDirectoryHandle | null = null;
  private serialQueue = new AsyncQueue();

  private async ensureInit(): Promise<void> {
    if (this.root)
      return;

    if (navigator.storage.persist) {
      const persisted = await navigator.storage.persist();
      console.log(`(deviceStorage.ts) persistence ${persisted ? "granted" : "denied"}`);
    }

    this.root = await navigator.storage.getDirectory();

    const lapseRoot = await this.getLapseDir();
    if (!await doesFileExist(lapseRoot, "store.json")) {
      console.log("(deviceStorage.ts) no OPFS store found - creating a new one");
      await this.writeStore({ devices: [], timelapse: null });
    }
    else {
      console.log("(deviceStorage.ts) existing OPFS store found");
    }

    if (await hasLegacyData()) {
      if (location.pathname !== "/migrate") {
        console.log("(deviceStorage.ts) legacy data found - redirecting to /migrate!");
        location.href = "/migrate";
      }
    }
    else {
      console.log("(deviceStorage.ts) no legacy data needed for redirect found");
    }
  }

  private async getLapseDir(): Promise<FileSystemDirectoryHandle> {
    return await this.root!.getDirectoryHandle("lapse", { create: true });
  }

  private async readStore(): Promise<Store> {
    await this.ensureInit();

    const dir = await this.getLapseDir();
    const fileHandle = await dir.getFileHandle("store.json");
    const file = await fileHandle.getFile();

    const contents = await file.text();

    try {
      return v.parse(StoreSchema, JSON.parse(contents));
    }
    catch (err) {
      posthog.capture("json_datastore_recovery_started", { contents, err });

      console.error(`(deviceStorage.ts) JSON store corrupted - rebuilding! ${contents}`, err);
      localStorage.setItem("lapse:corruptedStoreBackup", contents); // just in case...
      
      let restored: any = {};
      try {
        restored = JSON.parse(jsonrepair(contents));
      }
      catch (err) {
        console.warn(`(deviceStorage.ts) could not restore JSON - will rebuild completely. risky!`, err);
      }

      function tryGet<T>(keys: string[], defaultValue: T, coalesce: (x: unknown) => T): T {
        let current: any = restored;
        for (const key of keys) {
          if (
            current == null ||
            (typeof current !== "object" && typeof current !== "function") ||
            !(key in current)
          ) {
            return defaultValue;
          }

          current = current[key];
        }

        return coalesce(current);
      }

      const devices = tryGet(["devices"], [], (x) => {
        if (!Array.isArray(x))
          return [];

        return x.filter(x => "thisDevice" in x && x["thisDevice"]);
      });

      const snapshots = tryGet(["timelapse", "snapshots"], [], (x) => {
        if (Array.isArray(x))
          return x.map(x => typeof x === "number" ? x : Number(x));

        return [];
      });

      const startedAt = tryGet(["timelapse", "startedAt"], Date.now(), (x) => {
        return typeof x === "number" ? x : Number(x);
      });

      const sessions: number[] = [];

      // The sessions array is just a shortcut - we can recompute it by listing the contents of the directory
      // and querying all files in the Lapse directory with the format of "session-<ID>.webm".
      for await (const [filename] of dir.entries()) {
        const match = /session-([0-9]+)\.webm/.exec(filename);
        if (!match) {
          console.log(`(deviceStorage.ts) ignoring file ${filename} for session restore`);
          continue;
        }

        console.log(`(deviceStorage.ts) session found for restore: ${filename} (ID ${match[1]})`);
        sessions.push(parseInt(match[1]));
      }

      if (sessions.length == 0) {
        posthog.capture("json_datastore_recovery_no_timelapse", { contents, devices });
        console.warn("(deviceStorage.ts) no sessions found while restoring timelapse. no timelapse has been started...?");
        
        const store = {
          devices,
          timelapse: null
        };
        
        await this.writeStore(store);
        return store;
      }

      posthog.capture("json_datastore_recovery_success", { contents, devices, snapshots, startedAt, sessions });

      console.log("(deviceStorage.ts) existing timelapse successfully recovered from corrupted JSON!");
      console.log("(deviceStorage.ts) recovery payload:", devices, snapshots, startedAt, sessions);
      
      const data = {
        devices,
        timelapse: {
          snapshots,
          startedAt,
          sessions
        }
      };

      await this.writeStore(data);
      return data;
    }
  }

  private async writeStore(data: Store): Promise<void> {
    const dir = await this.getLapseDir();
    const fileHandle = await dir.getFileHandle("store.json", { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data));
    await writable.close();
  }

  private async operation<T>(block: () => Promise<T>) {
    return await this.serialQueue.enqueue(async () => {
      while (true) {
        try {
          return await block();
        }
        catch (error) {
          if (error instanceof DOMException && error.name == "NotReadableError") {
            await sleep(500); // race condition/browser locked the file while we were trying to read it...?
            continue;
          }

          throw error;
        }
      }
    });
  }

  /**
   * Imports a timelapse from a potentially foreign source.
   */
  async importTimelapse(metadata: LocalTimelapse, sessions: (readonly [number, Blob])[]) {
    return await this.operation(async () => {
      await this.ensureInit();

      const store = await this.readStore();
      store.timelapse = metadata;

      const dir = await this.getLapseDir();
      for (const [sessionId, blob] of sessions) {
        const fileHandle = await dir.getFileHandle(`session-${sessionId}.webm`, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
      }

      await this.writeStore(store);
      console.log("(deviceStorage.ts) imported timelapse data:", store.timelapse);

      return store.timelapse;
    });
  }

  async createTimelapse(): Promise<StoredTimelapse> {
    return await this.operation(async () => {
      await this.ensureInit();

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

  async getTimelapse(): Promise<StoredTimelapse | null> {
    return await this.operation(async () => {
      await this.ensureInit();

      const store = await this.readStore();
      if (!store.timelapse)
        return null;

      return store.timelapse;
    });
  }

  async getTimelapseVideoSessions(): Promise<Blob[]> {
    return await this.operation(async () => {
      await this.ensureInit();

      const store = await this.readStore();
      if (!store.timelapse)
        return [];

      const dir = await this.getLapseDir();
      const blobs: Blob[] = [];

      for (const sessionId of store.timelapse.sessions) {
        try {
          const fileHandle = await dir.getFileHandle(`session-${sessionId}.webm`);
          blobs.push(await fileHandle.getFile());
        }
        catch (err) {
          console.warn(`(deviceStorage.ts) could not read session ${sessionId} - skipping`, err);
        }
      }

      return blobs;
    });
  }

  async getTimelapseVideoSize(): Promise<number> {
    return await this.operation(async () => {
      await this.ensureInit();

      const store = await this.readStore();
      if (!store.timelapse)
        return 0;

      const dir = await this.getLapseDir();
      let totalSize = 0;

      for (const sessionId of store.timelapse.sessions) {
        try {
          const fileHandle = await dir.getFileHandle(`session-${sessionId}.webm`);
          const file = await fileHandle.getFile();
          totalSize += file.size;
        }
        catch (err) {
          console.warn(`(deviceStorage.ts) could not read session ${sessionId} size - skipping`, err);
        }
      }

      return totalSize;
    });
  }

  async appendChunk(sessionId: number, chunk: Blob): Promise<void> {
    console.debug(`(deviceStorage.ts) appendChunk(${sessionId}) ->`, chunk);

    return await this.operation(async () => {
      await this.ensureInit();

      const store = await this.readStore();
      if (!store.timelapse) {
        console.warn(`(deviceStorage.ts) attempted to call appendChunk, but no timelapse is registered!`, chunk);
        return;
      }

      if (!store.timelapse.sessions.includes(sessionId)) {
        store.timelapse.sessions.push(sessionId);
        await this.writeStore(store);
      }

      const dir = await this.getLapseDir();
      const fileHandle = await dir.getFileHandle(`session-${sessionId}.webm`, { create: true });
      const file = await fileHandle.getFile();
      const writable = await fileHandle.createWritable({ keepExistingData: true });
      await writable.seek(file.size);
      await writable.write(chunk);
      await writable.close();
    });
  }

  async deleteTimelapse(): Promise<void> {
    return await this.operation(async () => {
      await this.ensureInit();

      const store = await this.readStore();
      const sessions = store.timelapse?.sessions ?? [];
      store.timelapse = null;
      await this.writeStore(store);

      const dir = await this.getLapseDir();
      for (const sessionId of sessions) {
        try {
          await dir.removeEntry(`session-${sessionId}.webm`);
        }
        catch (err) {
          console.warn(`(deviceStorage.ts) could not delete session ${sessionId}`, err);
        }
      }

      console.log("(deviceStorage.ts) locally stored timelapse deleted");
    });
  }

  async appendSnapshot(timestamp: number): Promise<void> {
    return await this.operation(async () => {
      await this.ensureInit();

      const store = await this.readStore();
      if (!store.timelapse)
        return;

      store.timelapse.snapshots.push(timestamp);
      await this.writeStore(store);

      console.debug("(deviceStorage.ts) appendSnapshot ->", timestamp);
    });
  }

  async saveDevice(device: LocalDevice): Promise<string> {
    return await this.operation(async () => {
      await this.ensureInit();

      const store = await this.readStore();
      const existingIndex = store.devices.findIndex(d => d.id === device.id);

      if (existingIndex >= 0) {
        store.devices[existingIndex] = device;
      }
      else {
        store.devices.push(device);
      }

      await this.writeStore(store);

      console.log("(deviceStorage.ts) saveDevice ->", device);
      return device.id;
    });
  }

  async getDevice(id: string): Promise<LocalDevice | null> {
    return await this.operation(async () => {
      await this.ensureInit();

      const store = await this.readStore();
      return store.devices.find(d => d.id === id) ?? null;
    });
  }

  async getAllDevices(): Promise<LocalDevices> {
    return await this.operation(async () => {
      await this.ensureInit();

      const store = await this.readStore();
      return store.devices;
    });
  }

  async deleteDevice(id: string): Promise<void> {
    return await this.operation(async () => {
      await this.ensureInit();

      const store = await this.readStore();
      store.devices = store.devices.filter(d => d.id !== id);
      await this.writeStore(store);

      console.log(`(deviceStorage.ts) deleteDevice(${id})`);
    });
  }

  /**
   * Ensures all pending storage operations are complete.
   */
  async sync() {
    await this.serialQueue.synchronize();
    console.log("(deviceStorage.ts) device storage has been synchronized");
  }
}

/**
 * Allows for storing persistent binary data directly on the user's device.
 */
export const deviceStorage = new DeviceStorage();
