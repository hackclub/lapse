const IDB_NAME = "lapse";
const IDB_VERSION = 1;
const IDB_TIMELAPSES_STORE = "timelapses";
const IDB_SNAPSHOTS_STORE = "snapshots";
const IDB_DEVICES_STORE = "devices";

interface LegacyChunk {
  data: Blob;
  timestamp: number;
  session: number;
}

interface LegacyTimelapse {
  id: number;
  name: string;
  description: string;
  startedAt: number;
  chunks: LegacyChunk[];
  isActive: boolean;
}

interface LegacySnapshot {
  createdAt: number;
  session: number;
}

interface LegacyDevice {
  id: string;
  passkey: string;
  thisDevice: boolean;
}

export interface MigratedTimelapse {
  startedAt: number;
  snapshots: number[];
  sessions: number[];
  isActive: boolean;
}

export interface MigrationResult {
  timelapse: MigratedTimelapse | null;
  sessionBlobs: Map<number, Blob>;
  devices: LegacyDevice[];
}

function openLegacyDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);

    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      db.close();
      indexedDB.deleteDatabase(IDB_NAME);
      resolve(null);
    };
  });
}

function idbGetAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result ?? []);
  });
}

/**
 * Checks whether a legacy IndexedDB store exists that needs migration.
 */
export async function hasLegacyData(): Promise<boolean> {
  const databases = await indexedDB.databases();
  return databases.some(db => db.name === IDB_NAME);
}

/**
 * Reads all data from the legacy IndexedDB store and returns it in a format
 * compatible with the new OPFS-based storage.
 *
 * The most recent timelapse (if any) is migrated. Chunks belonging to the same
 * session are concatenated into a single Blob per session.
 */
export async function readLegacyData(): Promise<MigrationResult | null> {
  if (!await hasLegacyData())
    return null;

  const db = await openLegacyDb();
  if (!db)
    return null;

  try {
    const timelapses = await idbGetAll<LegacyTimelapse>(db, IDB_TIMELAPSES_STORE);
    const snapshots = await idbGetAll<LegacySnapshot>(db, IDB_SNAPSHOTS_STORE);
    const devices = await idbGetAll<LegacyDevice>(db, IDB_DEVICES_STORE);

    const activeTl = timelapses.find(t => t.isActive) ?? timelapses.at(-1) ?? null;

    let migratedTimelapse: MigratedTimelapse | null = null;
    const sessionBlobs = new Map<number, Blob>();

    if (activeTl) {
      const chunksBySession = new Map<number, Blob[]>();
      for (const chunk of activeTl.chunks) {
        const existing = chunksBySession.get(chunk.session);
        if (existing)
          existing.push(chunk.data);
        else
          chunksBySession.set(chunk.session, [chunk.data]);
      }

      const sessionIds: number[] = [];
      for (const [sessionId, chunks] of chunksBySession) {
        sessionIds.push(sessionId);
        sessionBlobs.set(sessionId, new Blob(chunks, { type: "video/webm" }));
      }

      const snapshotTimestamps = snapshots
        .toSorted((a, b) => a.createdAt - b.createdAt)
        .map(s => s.createdAt);

      migratedTimelapse = {
        startedAt: activeTl.startedAt,
        snapshots: snapshotTimestamps,
        sessions: sessionIds,
        isActive: activeTl.isActive,
      };
    }

    return { timelapse: migratedTimelapse, sessionBlobs, devices };
  }
  finally {
    db.close();
  }
}

/**
 * Deletes the legacy IndexedDB database after a successful migration.
 */
export async function deleteLegacyDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(IDB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
