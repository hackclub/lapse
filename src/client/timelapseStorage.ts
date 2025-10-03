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

const DB_NAME = "LapseStorage";
const DB_VERSION = 6;
const DB_STORE_NAME = "timelapses";
const DB_SNAPSHOTS_STORE_NAME = "snapshots";

class TimelapseStorage {
  db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = (event.target as IDBOpenDBRequest).transaction;
        const oldVersion = event.oldVersion;
        
        if (!db.objectStoreNames.contains(DB_STORE_NAME)) {
          db.createObjectStore(DB_STORE_NAME, { keyPath: "id", autoIncrement: true });
        }

        if (!db.objectStoreNames.contains(DB_SNAPSHOTS_STORE_NAME)) {
          db.createObjectStore(DB_SNAPSHOTS_STORE_NAME, {
            keyPath: "createdAt",
          });
        }
        
        // Migration for version 5: Remove frame index if it exists
        if (oldVersion < 5 && db.objectStoreNames.contains(DB_SNAPSHOTS_STORE_NAME)) {
          const snapshotStore = transaction!.objectStore(DB_SNAPSHOTS_STORE_NAME);
          if (snapshotStore.indexNames.contains("frame")) {
            snapshotStore.deleteIndex("frame");
          }
        }
        
        // Migration for version 6: Recreate snapshots store with createdAt key and remove timelapseId index
        if (oldVersion < 6 && db.objectStoreNames.contains(DB_SNAPSHOTS_STORE_NAME)) {
          const snapshotStore = transaction!.objectStore(DB_SNAPSHOTS_STORE_NAME);
          if (snapshotStore.indexNames.contains("timelapseId")) {
            snapshotStore.deleteIndex("timelapseId");
          }
          // Note: We can't change the keyPath of an existing store, so we'll delete and recreate
          db.deleteObjectStore(DB_SNAPSHOTS_STORE_NAME);
          db.createObjectStore(DB_SNAPSHOTS_STORE_NAME, {
            keyPath: "createdAt",
          });
        }
      };
    });
  }

  async saveTimelapse(timelapse: LocalTimelapse | Omit<LocalTimelapse, "id">): Promise<number> {
    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([DB_STORE_NAME], "readwrite");
      const store = transaction.objectStore(DB_STORE_NAME);
      const request = store.put(timelapse);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as number);

      console.log("(db) saveTimelapse ->", timelapse);
    });
  }

  async getTimelapse(id: number): Promise<LocalTimelapse | null> {
    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([DB_STORE_NAME], "readonly");
      const store = transaction.objectStore(DB_STORE_NAME);
      const request = store.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  async getActiveTimelapse(): Promise<LocalTimelapse | null> {
    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([DB_STORE_NAME], "readonly");
      const store = transaction.objectStore(DB_STORE_NAME);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const timelapses = request.result as LocalTimelapse[];
        const activeTimelapse = timelapses.find((t) => t.isActive);
        resolve(activeTimelapse || null);
      };
    });
  }

  async appendChunk(timelapseId: number, chunk: Blob, session: number): Promise<void> {
    const timelapse = await this.getTimelapse(timelapseId);
    if (!timelapse)
      return;

    const storedChunk: LocalChunk = {
      data: chunk,
      timestamp: Date.now(),
      session
    };

    timelapse.chunks.push(storedChunk);
    await this.saveTimelapse(timelapse);

    console.log(`(db) appendChunk(${timelapseId}) ->`, storedChunk);
  }

  async markComplete(timelapseId: number): Promise<void> {
    const timelapse = await this.getTimelapse(timelapseId);
    if (!timelapse)
      return;

    timelapse.isActive = false;
    await this.saveTimelapse(timelapse);

    console.log(`(db) markComplete(${timelapseId})`);
  }

  async deleteTimelapse(id: number): Promise<void> {
    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([DB_STORE_NAME], "readwrite");
      const store = transaction.objectStore(DB_STORE_NAME);
      const request = store.delete(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();

      console.log(`(db) deleteTimelapse(${id})`);
    });
  }

  async saveSnapshot(snapshot: LocalSnapshot): Promise<number> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [DB_SNAPSHOTS_STORE_NAME],
        "readwrite"
      );
      
      const store = transaction.objectStore(DB_SNAPSHOTS_STORE_NAME);
      const request = store.put(snapshot);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(snapshot.createdAt);

      console.log("(db) saveSnapshot ->", snapshot);
    });
  }

  async getAllSnapshots(): Promise<LocalSnapshot[]> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [DB_SNAPSHOTS_STORE_NAME],
        "readonly"
      );
      const store = transaction.objectStore(DB_SNAPSHOTS_STORE_NAME);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  }

  async deleteAllSnapshots(): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([DB_SNAPSHOTS_STORE_NAME], "readwrite");
      const store = transaction.objectStore(DB_SNAPSHOTS_STORE_NAME);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        console.log("(db) deleteAllSnapshots -> all snapshots deleted");
        resolve();
      };
    });
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

export const timelapseStorage = new TimelapseStorage();
