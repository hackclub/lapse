import * as v from "valibot";

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
  thisDevice: boolean;
}

/**
 * Collection of locally stored devices.
 */
export type LocalDevices = LocalDevice[];

const LocalTimelapseSchema = v.object({
  startedAt: v.number(),
  snapshots: v.array(v.number()),
  sessions: v.array(v.number()),
  isActive: v.boolean(),
});

const DeviceSchema = v.object({
  id: v.string(),
  passkey: v.string(),
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
  }

  private async getLapseDir(): Promise<FileSystemDirectoryHandle> {
    return await this.root!.getDirectoryHandle("lapse", { create: true });
  }

  private async readStore(): Promise<Store> {
    await this.ensureInit();

    const dir = await this.getLapseDir();
    const fileHandle = await dir.getFileHandle("store.json");
    const file = await fileHandle.getFile();
    const data = v.parse(StoreSchema, JSON.parse(await file.text()));

    return data;
  }

  private async writeStore(data: Store): Promise<void> {
    const dir = await this.getLapseDir();
    const fileHandle = await dir.getFileHandle("store.json", { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data));
    await writable.close();
  }

  private async operation<T>(block: () => Promise<T>) {
    return await this.serialQueue.enqueue(block);
  }

  async createTimelapse(): Promise<StoredTimelapse> {
    return await this.operation(async () => {
      await this.ensureInit();

      const store = await this.readStore();
      store.timelapse = {
        startedAt: Date.now(),
        snapshots: [],
        sessions: [],
        isActive: true
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

  async markComplete(): Promise<void> {
    return await this.operation(async () => {
      await this.ensureInit();

      const store = await this.readStore();
      if (!store.timelapse)
        return;

      store.timelapse.isActive = false;
      await this.writeStore(store);

      console.log("(deviceStorage.ts) timelapse marked as complete");
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
