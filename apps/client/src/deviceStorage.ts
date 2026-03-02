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
    snapshots: number[];
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

interface StoredChunk {
    timestamp: number;
    session: number;
}

interface StoredTimelapse {
    id: number;
    name: string;
    description: string;
    startedAt: number;
    chunks: StoredChunk[];
    snapshots: number[];
    isActive: boolean;
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

/**
 * Securely stores data on the client device using the Origin Private File System.
 */
export class DeviceStorage {
    private root: FileSystemDirectoryHandle | null = null;
    private serialQueue = new AsyncQueue();

    private async ensureInit(): Promise<void> {
        if (!this.root) {
            await this.init();
        }
    }

    private async init(): Promise<void> {
        if (navigator.storage.persist) {
            const persisted = await navigator.storage.persist();
            console.log(`(deviceStorage.ts) persistence ${persisted ? "granted" : "denied"}`);
        }

        this.root = await navigator.storage.getDirectory();
    }

    private async getDir(path: string[], create = false): Promise<FileSystemDirectoryHandle> {
        let dir = this.root!;
        for (const segment of path) {
            dir = await dir.getDirectoryHandle(segment, { create });
        }
        return dir;
    }

    private async readJson<T>(dir: FileSystemDirectoryHandle, name: string): Promise<T | null> {
        try {
            const fileHandle = await dir.getFileHandle(name);
            const file = await fileHandle.getFile();
            const text = await file.text();
            return JSON.parse(text) as T;
        }
        catch {
            return null;
        }
    }

    private async writeJson(dir: FileSystemDirectoryHandle, name: string, data: unknown): Promise<void> {
        const fileHandle = await dir.getFileHandle(name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(data));
        await writable.close();
    }

    private async writeBlob(dir: FileSystemDirectoryHandle, name: string, blob: Blob): Promise<void> {
        const fileHandle = await dir.getFileHandle(name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
    }

    private async readBlob(dir: FileSystemDirectoryHandle, name: string): Promise<Blob | null> {
        try {
            const fileHandle = await dir.getFileHandle(name);
            return await fileHandle.getFile();
        }
        catch {
            return null;
        }
    }

    private async nextTimelapseId(): Promise<number> {
        const timelapsesDir = await this.getDir(["timelapses"], true);
        const counter = await this.readJson<{ nextId: number }>(timelapsesDir, "_counter.json");
        const nextId = counter?.nextId ?? 1;
        await this.writeJson(timelapsesDir, "_counter.json", { nextId: nextId + 1 });
        return nextId;
    }

    private async operation<T>(block: () => Promise<T>) {
        return await this.serialQueue.enqueue(block);
    }

    private async _saveTimelapse(timelapse: LocalTimelapse | Omit<LocalTimelapse, "id">): Promise<number> {
        await this.ensureInit();

        let id: number;
        if ("id" in timelapse) {
            id = timelapse.id;
        }
        else {
            id = await this.nextTimelapseId();
        }

        const timelapseDir = await this.getDir(["timelapses", String(id)], true);
        const chunksDir = await this.getDir(["timelapses", String(id), "chunks"], true);

        const existingMeta = await this.readJson<StoredTimelapse>(timelapseDir, "meta.json");
        const existingChunkCount = existingMeta?.chunks.length ?? 0;

        for (let i = existingChunkCount; i < timelapse.chunks.length; i++) {
            await this.writeBlob(chunksDir, `${i}.bin`, timelapse.chunks[i].data);
        }

        const stored: StoredTimelapse = {
            id,
            name: timelapse.name,
            description: timelapse.description,
            startedAt: timelapse.startedAt,
            chunks: timelapse.chunks.map(c => ({ timestamp: c.timestamp, session: c.session })),
            snapshots: timelapse.snapshots,
            isActive: timelapse.isActive,
        };

        await this.writeJson(timelapseDir, "meta.json", stored);
        console.log("(deviceStorage.ts) saveTimelapse ->", stored);
        return id;
    }

    async saveTimelapse(timelapse: LocalTimelapse | Omit<LocalTimelapse, "id">): Promise<number> {
        return await this.operation(() => this._saveTimelapse(timelapse));
    }

    private async _getTimelapse(id: number): Promise<LocalTimelapse | null> {
        await this.ensureInit();

        try {
            const timelapseDir = await this.getDir(["timelapses", String(id)]);
            const meta = await this.readJson<StoredTimelapse>(timelapseDir, "meta.json");
            if (!meta) return null;

            const chunks: LocalChunk[] = [];

            if (meta.chunks.length > 0) {
                const chunksDir = await this.getDir(["timelapses", String(id), "chunks"]);

                for (let i = 0; i < meta.chunks.length; i++) {
                    const blob = await this.readBlob(chunksDir, `${i}.bin`);
                    if (!blob) continue;

                    chunks.push({
                        data: blob,
                        timestamp: meta.chunks[i].timestamp,
                        session: meta.chunks[i].session,
                    });
                }
            }

            return {
                id: meta.id,
                name: meta.name,
                description: meta.description,
                startedAt: meta.startedAt,
                chunks,
                snapshots: meta.snapshots,
                isActive: meta.isActive,
            };
        }
        catch {
            return null;
        }
    }

    async getTimelapse(id: number): Promise<LocalTimelapse | null> {
        return await this.operation(() => this._getTimelapse(id));
    }

    async getActiveTimelapse(): Promise<LocalTimelapse | null> {
        return await this.operation(async () => {
            await this.ensureInit();

            let timelapsesDir: FileSystemDirectoryHandle;
            try {
                timelapsesDir = await this.getDir(["timelapses"]);
            }
            catch {
                return null;
            }

            for await (const [, handle] of timelapsesDir.entries()) {
                if (handle.kind !== "directory") continue;

                const meta = await this.readJson<StoredTimelapse>(handle as FileSystemDirectoryHandle, "meta.json");
                if (meta?.isActive)
                    return await this._getTimelapse(meta.id);
            }

            return null;
        });
    }

    async appendChunk(timelapseId: number, chunk: Blob, session: number): Promise<void> {
        return await this.operation(async () => {
            await this.ensureInit();

            let timelapseDir: FileSystemDirectoryHandle;
            try {
                timelapseDir = await this.getDir(["timelapses", String(timelapseId)]);
            }
            catch {
                return;
            }

            const meta = await this.readJson<StoredTimelapse>(timelapseDir, "meta.json");
            if (!meta) return;

            const chunkIndex = meta.chunks.length;
            const chunksDir = await this.getDir(["timelapses", String(timelapseId), "chunks"], true);
            await this.writeBlob(chunksDir, `${chunkIndex}.bin`, chunk);

            meta.chunks.push({ timestamp: Date.now(), session });
            await this.writeJson(timelapseDir, "meta.json", meta);

            console.debug(`(deviceStorage.ts) appendChunk(${timelapseId}) -> chunk ${chunkIndex}`);
        });
    }

    async markComplete(timelapseId: number): Promise<void> {
        return await this.operation(async () => {
            await this.ensureInit();

            let timelapseDir: FileSystemDirectoryHandle;
            try {
                timelapseDir = await this.getDir(["timelapses", String(timelapseId)]);
            }
            catch {
                return;
            }

            const meta = await this.readJson<StoredTimelapse>(timelapseDir, "meta.json");
            if (!meta) return;

            meta.isActive = false;
            await this.writeJson(timelapseDir, "meta.json", meta);

            console.log(`(deviceStorage.ts) markComplete(${timelapseId})`);
        });
    }

    async deleteTimelapse(id: number): Promise<void> {
        return await this.operation(async () => {
            await this.ensureInit();

            try {
                const timelapsesDir = await this.getDir(["timelapses"]);
                await timelapsesDir.removeEntry(String(id), { recursive: true });
            }
            catch {
                // Directory doesn't exist
            }

            console.log(`(deviceStorage.ts) deleteTimelapse(${id})`);
        });
    }

    async appendSnapshot(timelapseId: number, timestamp: number): Promise<void> {
        return await this.operation(async () => {
            await this.ensureInit();

            let timelapseDir: FileSystemDirectoryHandle;
            try {
                timelapseDir = await this.getDir(["timelapses", String(timelapseId)]);
            }
            catch {
                return;
            }

            const meta = await this.readJson<StoredTimelapse>(timelapseDir, "meta.json");
            if (!meta) return;

            meta.snapshots.push(timestamp);
            await this.writeJson(timelapseDir, "meta.json", meta);

            console.debug(`(deviceStorage.ts) appendSnapshot(${timelapseId}) ->`, timestamp);
        });
    }

    async saveDevice(device: LocalDevice): Promise<string> {
        return await this.operation(async () => {
            await this.ensureInit();
            const devicesDir = await this.getDir(["devices"], true);
            await this.writeJson(devicesDir, `${device.id}.json`, device);

            console.log("(deviceStorage.ts) saveDevice ->", device);
            return device.id;
        });
    }

    async getDevice(id: string): Promise<LocalDevice | null> {
        return await this.operation(async () => {
            await this.ensureInit();
            const devicesDir = await this.getDir(["devices"], true);
            return await this.readJson<LocalDevice>(devicesDir, `${id}.json`);
        });
    }

    async getAllDevices(): Promise<LocalDevices> {
        return await this.operation(async () => {
            await this.ensureInit();

            let devicesDir: FileSystemDirectoryHandle;
            try {
                devicesDir = await this.getDir(["devices"]);
            }
            catch {
                return [];
            }

            const devices: LocalDevices = [];
            for await (const [name, handle] of devicesDir.entries()) {
                if (handle.kind !== "file" || !name.endsWith(".json")) continue;

                const device = await this.readJson<LocalDevice>(devicesDir, name);
                if (device) devices.push(device);
            }

            return devices;
        });
    }

    async deleteDevice(id: string): Promise<void> {
        return await this.operation(async () => {
            await this.ensureInit();

            try {
                const devicesDir = await this.getDir(["devices"]);
                await devicesDir.removeEntry(`${id}.json`);
            }
            catch {
                // File doesn't exist
            }

            console.log(`(deviceStorage.ts) deleteDevice(${id})`);
        });
    }

    /**
     * Ensures all pending storage operations are complete.
     */
    async sync() {
        await this.serialQueue.synchronize();
    }
}

export const deviceStorage = new DeviceStorage();
