import { AsyncQueue } from "@/shared/queuing";

/**
 * Represents a locally stored snapshot. This will represent the structure on the server-side database.
 */
export interface LocalSnapshot {
    createdAt: number;
    session: number;
}

/**
 * Represents a video chunk. Serves to guard against interruptions between recordings.
 * Chunks are merged together into one video stream before being uploaded to the server.
 */
export interface LocalChunk {
    data: Blob;
    timestamp: number;
    session: number;
}

/**
 * An in-progress timelapse, stored locally.
 */
export interface LocalTimelapse {
    id: number;
    name: string;
    description: string;
    startedAt: number;
    chunks: LocalChunk[];
    isActive: boolean;
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

const DB_NAME = "lapse";
const DB_VERSION = 1;
const DB_TIMELAPSES_STORE_NAME = "timelapses";
const DB_SNAPSHOTS_STORE_NAME = "snapshots";
const DB_DEVICES_STORE_NAME = "devices";

/**
 * Securely stores data on the client device. 
 */
export class DeviceStorage {
    db: IDBDatabase | null = null;
    private serialQueue = new AsyncQueue();

    private async ensureInit(): Promise<void> {
        if (!this.db) {
            await this.init();
        }
    }

    private async init(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                
                if (!db.objectStoreNames.contains(DB_TIMELAPSES_STORE_NAME)) {
                    db.createObjectStore(DB_TIMELAPSES_STORE_NAME, { keyPath: "id", autoIncrement: true });
                }
                
                if (!db.objectStoreNames.contains(DB_SNAPSHOTS_STORE_NAME)) {
                    db.createObjectStore(DB_SNAPSHOTS_STORE_NAME, { keyPath: "createdAt" });
                }
                
                if (!db.objectStoreNames.contains(DB_DEVICES_STORE_NAME)) {
                    db.createObjectStore(DB_DEVICES_STORE_NAME, { keyPath: "id" });
                }
                
                console.log("(deviceStorage.ts) upgrade completed");
            };
        });
    }

    private async transact<T>(
        storeNames: string[],
        mode: "readonly" | "readwrite",
        operation: (store: IDBObjectStore) => IDBRequest
    ): Promise<T> {
        await this.ensureInit();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(storeNames, mode);
            const store = transaction.objectStore(storeNames[0]);
            const request = operation(store);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    private async operation<T>(block: () => Promise<T>) {
        return await this.serialQueue.enqueue(block);
    }

    private async _saveTimelapse(timelapse: LocalTimelapse | Omit<LocalTimelapse, "id">): Promise<number> {
        await this.ensureInit();
        const result = await this.transact<number>(
            [DB_TIMELAPSES_STORE_NAME],
            "readwrite",
            (store) => store.put(timelapse)
        );

        console.log("(deviceStorage.ts) saveTimelapse ->", timelapse);
        return result;
    }

    async saveTimelapse(timelapse: LocalTimelapse | Omit<LocalTimelapse, "id">): Promise<number> {
        return await this.operation(() => this._saveTimelapse(timelapse));
    }

    private async _getTimelapse(id: number): Promise<LocalTimelapse | null> {
        await this.ensureInit();
        const result = await this.transact<LocalTimelapse>(
            [DB_TIMELAPSES_STORE_NAME],
            "readonly",
            (store) => store.get(id)
        );

        return result || null;
    }

    async getTimelapse(id: number): Promise<LocalTimelapse | null> {
        return await this.operation(() => this._getTimelapse(id));
    }

    async getActiveTimelapse(): Promise<LocalTimelapse | null> {
        return await this.operation(async () => {
            await this.ensureInit();
            const timelapses = await this.transact<LocalTimelapse[]>(
                [DB_TIMELAPSES_STORE_NAME],
                "readonly",
                (store) => store.getAll()
            );

            return timelapses.find((t) => t.isActive) || null;
        });
    }

    async appendChunk(timelapseId: number, chunk: Blob, session: number): Promise<void> {
        return await this.operation(async () => {
            const timelapse = await this._getTimelapse(timelapseId);
            if (!timelapse)
                return;

            const storedChunk: LocalChunk = {
                data: chunk,
                timestamp: Date.now(),
                session
            };

            timelapse.chunks.push(storedChunk);
            await this._saveTimelapse(timelapse);

            console.debug(`(deviceStorage.ts) appendChunk(${timelapseId}) ->`, storedChunk);
        });
    }

    async markComplete(timelapseId: number): Promise<void> {
        return await this.operation(async () => {
            const timelapse = await this._getTimelapse(timelapseId);
            if (!timelapse)
                return;

            timelapse.isActive = false;
            await this._saveTimelapse(timelapse);

            console.log(`(deviceStorage.ts) markComplete(${timelapseId})`);
        }); 
    }

    async deleteTimelapse(id: number): Promise<void> {
        return await this.operation(async () => {
            await this.ensureInit();
            await this.transact<void>(
                [DB_TIMELAPSES_STORE_NAME],
                "readwrite",
                (store) => store.delete(id)
            );

            console.log(`(deviceStorage.ts) deleteTimelapse(${id})`);
        });
    }

    async saveSnapshot(snapshot: LocalSnapshot): Promise<number> {
        return await this.operation(async () => {
            await this.ensureInit();
            await this.transact<number>(
                [DB_SNAPSHOTS_STORE_NAME],
                "readwrite",
                (store) => store.put(snapshot)
            );

            console.debug("(deviceStorage.ts) saveSnapshot ->", snapshot);
            return snapshot.createdAt;
        });
    }

    async getAllSnapshots(): Promise<LocalSnapshot[]> {
        return await this.operation(async () => {
            await this.ensureInit();
            const result = await this.transact<LocalSnapshot[]>(
                [DB_SNAPSHOTS_STORE_NAME],
                "readonly",
                (store) => store.getAll()
            );

            return result || [];
        });
    }

    async deleteAllSnapshots(): Promise<void> {
        return await this.operation(async () => {
            await this.ensureInit();
            await this.transact<void>(
                [DB_SNAPSHOTS_STORE_NAME],
                "readwrite",
                (store) => store.clear()
            );

            console.log("(deviceStorage.ts) deleteAllSnapshots -> all snapshots deleted");
        });
    }

    async saveDevice(device: LocalDevice): Promise<string> {
        return await this.operation(async () => {
            await this.ensureInit();
            await this.transact<string>(
                [DB_DEVICES_STORE_NAME],
                "readwrite",
                (store) => store.put(device)
            );

            console.log("(deviceStorage.ts) saveDevice ->", device);
            return device.id;
        });
    }

    async getDevice(id: string): Promise<LocalDevice | null> {
        return await this.operation(async () => {
            await this.ensureInit();
            const result = await this.transact<LocalDevice>(
                [DB_DEVICES_STORE_NAME],
                "readonly",
                (store) => store.get(id)
            );

            return result || null;
        });
    }

    async getAllDevices(): Promise<LocalDevices> {
        return await this.operation(async () => {
            await this.ensureInit();
            const result = await this.transact<LocalDevices>(
                [DB_DEVICES_STORE_NAME],
                "readonly",
                (store) => store.getAll()
            );

            return result || [];
        });
    }

    async deleteDevice(id: string): Promise<void> {
        return await this.operation(async () => {
            await this.ensureInit();
            await this.transact<void>(
                [DB_DEVICES_STORE_NAME],
                "readwrite",
                (store) => store.delete(id)
            );

            console.log(`(deviceStorage.ts) deleteDevice(${id})`);
        });
    }

    /**
     * Ensures all pending database operations are complete.
     */
    async sync() {
        await this.serialQueue.synchronize();
    }
}

/**
 * Utility to get snapshots with computed frame numbers based on creation timestamp order
 */
export function getSnapshotsWithFrameNumbers(snapshots: LocalSnapshot[]): (LocalSnapshot & { frame: number })[] {
    const sorted = snapshots.toSorted((a, b) => a.createdAt - b.createdAt);
    return sorted.map((snapshot, index) => ({
        ...snapshot,
        frame: index
    }));
}

export const deviceStorage = new DeviceStorage();
