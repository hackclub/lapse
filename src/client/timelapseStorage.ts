/**
 * Represents a locally stored snapshot. This will represent the structure on the server-side database.
 */
export interface LocalSnapshot {
  id: number;
  frame: number;
  createdAt: number;
  timelapseId: number;
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
  frameCount: number;
  isActive: boolean;
}

const DB_NAME = "LapseStorage";
const DB_VERSION = 4;
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
        if (!db.objectStoreNames.contains(DB_STORE_NAME)) {
          db.createObjectStore(DB_STORE_NAME, { keyPath: "id", autoIncrement: true });
        }

        if (!db.objectStoreNames.contains(DB_SNAPSHOTS_STORE_NAME)) {
          const snapshotStore = db.createObjectStore(DB_SNAPSHOTS_STORE_NAME, {
            keyPath: "id",
            autoIncrement: true,
          });

          snapshotStore.createIndex("timelapseId", "timelapseId", {
            unique: false,
          });

          snapshotStore.createIndex("frame", "frame", { unique: false });
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

  async updateFrameCount(timelapseId: number, frameCount: number): Promise<void> {
    const timelapse = await this.getTimelapse(timelapseId);
    if (!timelapse)
      return;

    timelapse.frameCount = frameCount;
    await this.saveTimelapse(timelapse);

    console.log(`(db) updateFrameCount(${timelapseId}) -> ${frameCount}`);
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

  async saveSnapshot(snapshot: LocalSnapshot | Omit<LocalSnapshot, "id">): Promise<number> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [DB_SNAPSHOTS_STORE_NAME],
        "readwrite"
      );
      
      const store = transaction.objectStore(DB_SNAPSHOTS_STORE_NAME);
      const request = store.put(snapshot);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as number);

      console.log("(db) saveSnapshot ->", snapshot);
    });
  }

  async getSnapshotsForTimelapse(
    timelapseId: number
  ): Promise<LocalSnapshot[]> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [DB_SNAPSHOTS_STORE_NAME],
        "readonly"
      );
      const store = transaction.objectStore(DB_SNAPSHOTS_STORE_NAME);
      const index = store.index("timelapseId");
      const request = index.getAll(timelapseId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  }

  async deleteSnapshotsForTimelapse(timelapseId: number): Promise<void> {
    if (!this.db) await this.init();

    const snapshots = await this.getSnapshotsForTimelapse(timelapseId);

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([DB_SNAPSHOTS_STORE_NAME], "readwrite");
      const store = transaction.objectStore(DB_SNAPSHOTS_STORE_NAME);

      let completed = 0;
      const total = snapshots.length;

      if (total === 0) {
        resolve();
        return;
      }

      snapshots.forEach((snapshot) => {
        const request = store.delete(snapshot.id);
        request.onsuccess = () => {
          completed++;
          if (completed === total) {
            console.log(
              `(db) deleteSnapshotsForTimelapse(${timelapseId}) -> ${total} snapshots deleted`
            );
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      });
    });
  }
}

export const timelapseStorage = new TimelapseStorage();
