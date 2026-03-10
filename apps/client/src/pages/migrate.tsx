import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { ascending, encryptData, fromHex } from "@hackclub/lapse-shared";

import RootLayout from "@/components/layout/RootLayout";
import { LoadingModal } from "@/components/layout/LoadingModal";
import { ErrorModal } from "@/components/layout/ErrorModal";
import { api, apiUpload } from "@/api";
import { deviceStorage } from "@/deviceStorage";
import { getCurrentDevice } from "@/encryption";
import { videoGenerateThumbnail } from "@/video";
import { sfetch } from "@/safety";
import { useOnce } from "@/hooks/useOnce";

const IDB_NAME = "lapse";
const IDB_VERSION = 1;
const IDB_TIMELAPSES_STORE = "timelapses";
const IDB_SNAPSHOTS_STORE = "snapshots";
const IDB_DEVICES_STORE = "devices";

// This page deals with migration old Lapse V1 data to the new V2 client.
// For reference:
//    client/deviceStorage.ts: https://github.com/hackclub/lapse/blob/a70359cdcb2d629e1771893d678b7df4c996929c/apps/web/src/client/deviceStorage.ts
//    client/encryption.ts: https://github.com/hackclub/lapse/blob/a70359cdcb2d629e1771893d678b7df4c996929c/apps/web/src/client/encryption.ts
//    server/encryption.ts: https://github.com/hackclub/lapse/blob/a70359cdcb2d629e1771893d678b7df4c996929c/apps/web/src/server/encryption.ts

/**
 * Checks whether a legacy IndexedDB store exists that needs migration.
 */
export async function hasLegacyData(): Promise<boolean> {
  const databases = await indexedDB.databases();
  return databases.some(db => db.name === IDB_NAME);
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

function idbOpen(): Promise<IDBDatabase | null> {
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

/**
 * Derives salt for decrypting data that was encrypted with the legacy 6-digit passkey encryption scheme.
 */
async function legacyDeriveSalts(timelapseId: string): Promise<{ keySalt: ArrayBuffer; ivSalt: ArrayBuffer }> {
  const encoder = new TextEncoder();

  const keySaltKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("timelapse-key-salt"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const keySalt = await crypto.subtle.sign("HMAC", keySaltKey, encoder.encode(timelapseId));

  const ivSaltKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("timelapse-iv-salt"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const ivSalt = await crypto.subtle.sign("HMAC", ivSaltKey, encoder.encode(timelapseId));

  return { keySalt, ivSalt };
}

/**
 * Decrypts data that was encrypted with the legacy 6-digit passkey encryption scheme.
 */
export async function legacyDecryptData(encryptedData: ArrayBuffer, timelapseId: string, passkey: string): Promise<ArrayBuffer> {
  const { keySalt, ivSalt } = await legacyDeriveSalts(timelapseId);

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passkey),
    { name: "PBKDF2" },
    false,
    ["deriveKey", "deriveBits"]
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: keySalt,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-CBC", length: 256 },
    false,
    ["decrypt"]
  );

  const iv = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: ivSalt,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    128
  );

  return await crypto.subtle.decrypt(
    { name: "AES-CBC", iv },
    key,
    encryptedData
  );
}

interface MigrationProgress {
  stage: string;
  progress?: number;
}

async function runMigration(onProgress: (progress: MigrationProgress) => void) {
  onProgress({ stage: "Checking for legacy data..." });

  if (!await hasLegacyData())
    return;

  const db = await idbOpen();
  if (!db)
    return;

  let timelapseImported = false;

  try {
    // We expect only *one* legacy timelapse. We merge its data by creating a new local timelapse with its
    // data on our side. The sessions should merge safely.
    const timelapses = await idbGetAll<{
      id: number;
      name: string;
      description: string;
      startedAt: number;
      chunks: {
        data: Blob;
        timestamp: number;
        session: number;
      }[];
      isActive: boolean;
    }>(db, IDB_TIMELAPSES_STORE);

    if (timelapses.length > 0) {
      onProgress({ stage: "Importing local timelapse data..." });

      const snapshots = await idbGetAll<{
        createdAt: number;
        session: number;
      }>(db, IDB_SNAPSHOTS_STORE);

      const timelapse = timelapses[0]; // anything more is non-standard

      // This might seem like voodoo magic, but all we're doing here is grouping all chunks by session,
      // making sure each session has at least one chunk, and then we're going over all of the sessions and
      // changing the arrays of Blob's to just one big Blob via the `blobParts` constructor.
      //
      // In the map, we're doing `v[0].data.type` - we're getting the first chunk of the session and taking its
      // type, as Blob won't infer it automatically. We don't assume video/webm, as V1 captured in a variety of
      // formats (and actually preferred AVC, so video/mp4).
      const chunksBySession = Map.groupBy(timelapse.chunks, x => x.session)
        .entries()
        .filter(([k, v]) => v.length > 0) // ignore empty sessions
        .map(([k, v]) => [ k, new Blob(v.map(x => x.data), { type: v[0].data.type }) ] as const)
        .toArray();

      await deviceStorage.importTimelapse(
        {
          startedAt: timelapse.startedAt,
          snapshots: snapshots.map(x => x.createdAt).toSorted(ascending()),
          sessions: chunksBySession.map(x => x[0])
        },
        chunksBySession
      );

      timelapseImported = true;
    }

    // Nice - timelapse import done. Now, we move onto devices. These are only used to decrypt the timelapses we
    // have right now (we'll get them via draftTimelapse.legacy) in a jiffy - after we convert all of them to
    // draft timelapses, there's no real reason to keep them around.
    const devices = await idbGetAll<{
      id: string;
      passkey: string;
      thisDevice: boolean;
    }>(db, IDB_DEVICES_STORE);

    onProgress({ stage: "Fetching legacy timelapses..." });

    const legacyDrafts = await api.draftTimelapse.legacy({});
    if (!legacyDrafts.ok)
      throw new Error(`Could not fetch legacy timelapses: ${legacyDrafts.message}`);

    const totalDrafts = legacyDrafts.data.timelapses.length;

    for (const [i, draft] of legacyDrafts.data.timelapses.entries()) {
      const draftLabel = totalDrafts > 1 ? ` (${i + 1}/${totalDrafts})` : "";
      const device = devices.find(x => x.id == draft.deviceId);
      if (!device)
        continue; // this doesn't concern us; we didn't have a device registered for that timelapse

      onProgress({ stage: `Downloading video${draftLabel}...` });

      const res = await sfetch(draft.primarySession);
      if (!res.ok)
        throw new Error(`Could not fetch data for session ${draft.primarySession} (legacy ID ${draft.id})`);

      const data = await res.arrayBuffer();

      onProgress({ stage: `Decrypting video${draftLabel}...` });
      const decryptedVideo = await legacyDecryptData(data, draft.id, device.passkey); // important: "passkey" here is from the OLD indexeddb!!!

      let decryptedThumb: ArrayBuffer;

      try {
        const res = await sfetch(draft.thumbnailUrl);
        if (!res.ok)
          throw new Error(`Could not fetch thumbnail: ${draft.thumbnailUrl} (thumbnail w/ ID ${draft.id})`);

        const data = await res.arrayBuffer();
        decryptedThumb = await legacyDecryptData(data, draft.id, device.passkey);
      }
      catch (err) {
        console.error("(migrate.tsx) could not decrypt thumbnail, falling back to manual generation!", err);
        const blob = await videoGenerateThumbnail(new Blob([decryptedVideo], { type: "video/webm" }));
        decryptedThumb = await blob.arrayBuffer();
      }

      // Now - we decrypted everything from our legacy encryption model (which didn't have much entropy...),
      // and now we re-encrypt and immediately upload it to the server.

      onProgress({ stage: `Re-encrypting${draftLabel}...` });

      const actualDevice = await getCurrentDevice(); // this is our non-legacy device

      const creation = await api.draftTimelapse.create({
        snapshots: draft.snapshots,
        deviceId: actualDevice.id,
        sessions: [{ fileSize: decryptedVideo.byteLength + 8192 }],
        thumbnailSize: decryptedThumb.byteLength + 8192,
        name: draft.name,
        description: draft.description
      });

      if (!creation.ok)
        throw new Error(`API request to draftTimelapse.create failed! ${creation.message}`);

      const passkey = fromHex(actualDevice.passkey).buffer;
      const iv = fromHex(creation.data.draftTimelapse.iv).buffer;

      const encryptedVideo = await encryptData(passkey, iv, decryptedVideo);
      const encryptedThumb = await encryptData(passkey, iv, decryptedThumb); 

      onProgress({ stage: `Uploading video${draftLabel}...`, progress: 0 });
      await apiUpload(
        creation.data.sessionUploadTokens[0],
        new Blob([encryptedVideo], { type: "video/webm" }),
        (uploaded, total) => onProgress({ stage: `Uploading video${draftLabel}...`, progress: (uploaded / total) * 100 })
      );

      onProgress({ stage: `Uploading thumbnail${draftLabel}...` });
      await apiUpload(creation.data.thumbnailUploadToken, new Blob([encryptedThumb], { type: "image/webp" }));
    
      // And we're done! The new draft now lives on the server and this device can decrypt it.
      console.log(`(migrate.tsx) legacy timelapse ${draft.id} migrated to ${creation.data.draftTimelapse.id}!`);
    }

    // No errors - and thus we assume everything went okay. Removing this data permanently is still scary, though.
    onProgress({ stage: "Cleaning up legacy data..." });
    console.log("(migrate.tsx) all drafts migrated successfully! removing IndexedDB - dangerous!");
    
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(IDB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    console.log("(migrate.tsx) IndexedDB removed. all Lapse V1 data has been migrated from this device!");
  }
  finally {
    db.close();

    // If we're throwing a hissy fit, we won't be deleting IndexedDB content, so prevent data duplication
    if (timelapseImported) {
      await deviceStorage.deleteTimelapse();
    }
  }
}

export default function MigratePage() {
  const router = useRouter();
  const [stage, setStage] = useState("Starting migration...");
  const [progress, setProgress] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useOnce(() => {
    runMigration(({ stage, progress }) => {
      setStage(stage);
      setProgress(progress);
    })
      .then(() => router.replace("/"))
      .catch(err => {
        console.error("(migrate.tsx) migration failed:", err);
        setError(err instanceof Error ? err.message : "An unknown error occurred during migration");
      });
  });

  useEffect(() => {
    if (error)
      return;

    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [error]);

  return (
    <RootLayout title="Lapse — Migrating" showHeader={false}>
      <LoadingModal
        isOpen={!error}
        title="Migrating your data"
        message={`${stage} Please do not close this tab.`}
        progress={progress}
      />

      <ErrorModal
        isOpen={!!error}
        setIsOpen={(open) => !open && setError(null)}
        message={error || ""}
        onClose={() => router.replace("/")}
      />
    </RootLayout>
  );
}
