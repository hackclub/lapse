import type { DraftTimelapse } from "@hackclub/lapse-api";
import { THUMBNAIL_SIZE } from "@hackclub/lapse-api";
import { encryptData, fromHex, MIN_SESSION_SIZE_BYTES } from "@hackclub/lapse-shared";

import { api, apiUpload } from "@/api";
import { deviceStorage, DeviceStorage } from "@/deviceStorage";
import { getCurrentDevice } from "@/encryption";

// Recovery of recordings made with the pre-Lookout pipeline. There are two leftover sources:
//
//   1. "opfs"  - unfinished recordings still sitting in this device's local storage (OPFS), never uploaded.
//   2. "draft" - `DraftTimelapse` records already encrypted and uploaded to R2, but never published.
//
// Both can be published (re-encoded server-side) or discarded. We deliberately do NOT let the user keep
// recording either of them - the legacy capture pipeline no longer exists.

/**
 * Version of the local-recording restore logic. On a successful publish we keep the OPFS copy as a safety net and
 * tag it with this version rather than deleting it. If a restore turns out to be faulty, bump this constant: copies
 * tagged with an older version are no longer considered "restored" and resurface in the recovery banner/list for
 * re-publish. A later sweep (`deviceStorage.cleanupRestoredTimelapse`) reclaims the space once we're confident.
 */
export const CURRENT_RESTORE_VERSION = 1;

/**
 * A single recoverable legacy recording. There is at most one `opfs` item (local storage only holds one
 * in-progress recording), plus any number of `draft` items.
 */
export type RecoverableItem =
  | { kind: "opfs"; id: "opfs"; createdAt: number; snapshotCount: number }
  | { kind: "draft"; id: string; createdAt: number; draft: DraftTimelapse };

/**
 * A 1x1 black WebP, used when a real thumbnail can't be decoded from the recording.
 */
const FALLBACK_THUMBNAIL = "data:image/webp;base64,UklGRiwAAABXRUJQVlA4TB8AAAAvf8JZAAcQEf0PCAkS/4+3EtH/jP/85z//+c9//l8AAA==";

/**
 * Generates a preview thumbnail (WebP) from a recorded video session by capturing its first decoded frame.
 * Falls back to a black image if the video can't be decoded.
 */
export async function videoGenerateThumbnail(videoBlob: Blob): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const video = document.createElement("video");
  const objectUrl = URL.createObjectURL(videoBlob);

  try {
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;

    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Could not decode video"));
      video.src = objectUrl;
    });

    const vw = video.videoWidth || THUMBNAIL_SIZE;
    const vh = video.videoHeight || THUMBNAIL_SIZE;

    canvas.width = vw >= vh ? THUMBNAIL_SIZE : Math.floor((THUMBNAIL_SIZE * vw) / vh);
    canvas.height = vh >= vw ? THUMBNAIL_SIZE : Math.floor((THUMBNAIL_SIZE * vh) / vw);

    const ctx = canvas.getContext("2d");
    if (!ctx)
      throw new Error("Could not get a 2D canvas context");

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp"));
    if (!blob)
      throw new Error("canvas.toBlob() returned null");

    return blob;
  }
  catch (err) {
    console.warn("(legacyRecovery.ts) could not generate thumbnail - using fallback", err);
    return await fetch(FALLBACK_THUMBNAIL).then(x => x.blob());
  }
  finally {
    URL.revokeObjectURL(objectUrl);
    video.remove();
    canvas.remove();
  }
}

type LocalTimelapse = NonNullable<Awaited<ReturnType<typeof deviceStorage.getTimelapse>>>;

/**
 * Loads the local (OPFS) recording, but only if it meets every requirement the publish path enforces: usable OPFS,
 * at least two snapshots (needed to derive a non-zero duration), and at least one session over the minimum size.
 * Returns `null` otherwise.
 *
 * `hasLocalRecording` and `publishLocalRecording` share this check so the recovery banner never counts/lists a
 * local recording that publishing would then refuse - which would otherwise leave a permanent "unmigrated
 * timelapse" nag that only Discard could clear.
 */
async function getPublishableLocalRecording(): Promise<{ local: LocalTimelapse; sessions: Blob[] } | null> {
  // Browsers without usable OPFS never produced a local recording, so there's nothing to recover there. We use the
  // side-effect-free `DeviceStorage.isSupported` rather than touching `deviceStorage`, so merely probing for
  // recoverable data (e.g. on the homepage) doesn't bounce unsupported browsers to `/update-browser`.
  if (!DeviceStorage.isSupported())
    return null;

  const local = await deviceStorage.getTimelapse();
  if (!local || local.sessions.length === 0)
    return null;

  // Already restored under the current logic: kept only as a safety net, not something to offer/publish again. If
  // CURRENT_RESTORE_VERSION is later bumped (a restore was found faulty), older-versioned copies fall through here
  // and resurface for re-publish.
  if (local.restoredVersion != null && local.restoredVersion >= CURRENT_RESTORE_VERSION)
    return null;

  // The published timelapse's duration is derived from its snapshots (`durationBySnapshots` needs at least two).
  if (local.snapshots.length < 2)
    return null;

  // Guard against impossibly small / empty sessions left behind by a crashed recording.
  const sessions = (await deviceStorage.getTimelapseVideoSessions())
    .filter(x => x.size > MIN_SESSION_SIZE_BYTES);
  if (sessions.length === 0)
    return null;

  return { local, sessions };
}

/**
 * Returns whether there's a publishable unfinished recording sitting in this device's local (OPFS) storage.
 */
async function hasLocalRecording(): Promise<boolean> {
  return (await getPublishableLocalRecording()) !== null;
}

/**
 * Loads every legacy recording that can be recovered for `userId`: the local unfinished recording (if any) plus
 * all uploaded-but-unpublished draft timelapses.
 */
export async function loadRecoverableItems(userId: string): Promise<RecoverableItem[]> {
  const items: RecoverableItem[] = [];

  try {
    if (await hasLocalRecording()) {
      const local = await deviceStorage.getTimelapse();
      if (local) {
        items.push({
          kind: "opfs",
          id: "opfs",
          createdAt: local.startedAt,
          snapshotCount: local.snapshots.length,
        });
      }
    }
  }
  catch (err) {
    console.warn("(legacyRecovery.ts) could not inspect local storage for recoverable recordings", err);
  }

  const res = await api.draftTimelapse.findByUser({ user: userId });
  if (res.ok) {
    for (const draft of res.data.timelapses) {
      // Drafts that are already being published have an associated (processing) timelapse - skip those.
      if (draft.associatedTimelapseId)
        continue;

      items.push({ kind: "draft", id: draft.id, createdAt: draft.createdAt, draft });
    }
  }

  return items;
}

/**
 * Counts how many recoverable legacy recordings `userId` has. Used to drive the "unmigrated timelapses" banner.
 * Returns 0 (rather than throwing) if the check fails, so a transient error never surfaces a misleading prompt.
 */
export async function countRecoverableItems(userId: string): Promise<number> {
  try {
    return (await loadRecoverableItems(userId)).length;
  }
  catch (err) {
    console.warn("(legacyRecovery.ts) countRecoverableItems check failed", err);
    return 0;
  }
}

/**
 * Publishes an already-uploaded draft timelapse as UNLISTED. Requires the key of the device that recorded it.
 */
async function publishDraft(draft: DraftTimelapse): Promise<void> {
  const device = await deviceStorage.getDevice(draft.deviceId);
  if (!device)
    throw new Error("This draft was recorded on a different device, so it can't be published from here.");

  const res = await api.timelapse.publish({
    id: draft.id,
    visibility: "UNLISTED",
    deviceKey: device.passkey,
  });

  if (!res.ok)
    throw new Error(res.message);
}

/**
 * Uploads the local (OPFS) recording's encrypted sessions to R2, turns it into a draft, and publishes it as
 * UNLISTED. On success the local recording is removed from device storage.
 */
async function publishLocalRecording(): Promise<void> {
  await deviceStorage.sync();

  // Refusing here (rather than after `create`) keeps the local copy intact instead of publishing a degenerate
  // timelapse and then deleting the only source of the recording. Mirrors exactly what `hasLocalRecording` counts.
  const publishable = await getPublishableLocalRecording();
  if (!publishable)
    throw new Error("This recording is too short or incomplete to publish.");

  const { local, sessions } = publishable;

  const thumbnail = await videoGenerateThumbnail(sessions[0]);
  const device = await getCurrentDevice();

  const createRes = await api.draftTimelapse.create({
    snapshots: local.snapshots,
    thumbnailSize: thumbnail.size,
    deviceId: device.id,
    // Encryption adds up to a block of padding, so give every session a small upload margin.
    sessions: sessions.map(x => ({ fileSize: x.size + 8192 })),
  });

  if (!createRes.ok)
    throw new Error(createRes.message);

  const draftId = createRes.data.draftTimelapse.id;

  try {
    const { iv } = createRes.data.draftTimelapse;
    const key = fromHex(device.passkey).buffer;
    const ivBuffer = fromHex(iv).buffer;

    for (const [i, session] of sessions.entries()) {
      const encrypted = await encryptData(key, ivBuffer, session);
      await apiUpload(createRes.data.sessionUploadTokens[i], new Blob([encrypted], { type: "video/webm" }));
    }

    const encryptedThumbnail = await encryptData(key, ivBuffer, thumbnail);
    await apiUpload(createRes.data.thumbnailUploadToken, new Blob([encryptedThumbnail], { type: "image/webp" }));

    const publishRes = await api.timelapse.publish({
      id: draftId,
      visibility: "UNLISTED",
      deviceKey: device.passkey,
    });

    if (!publishRes.ok)
      throw new Error(publishRes.message);
  }
  catch (err) {
    // The draft record exists server-side, but we never finished uploading/publishing it. Left behind, it would
    // resurface as an orphan "draft" recoverable item (no associated timelapse), so it - and every failed retry -
    // would pile up in the recovery list and banner count. Delete it so a retry starts clean; keep the local copy.
    await api.draftTimelapse.delete({ id: draftId }).catch(delErr => {
      console.warn("(legacyRecovery.ts) failed to clean up partially-created draft after a publish error", delErr);
    });
    throw err;
  }

  // The recording is safely published. We keep the local copy as a safety net (in case server-side processing is
  // faulty) and just mark it restored, so the banner/list stop offering it. A later sweep reclaims the space.
  await deviceStorage.markTimelapseRestored(CURRENT_RESTORE_VERSION);
}

/**
 * Publishes a recoverable item (UNLISTED). Throws on failure, leaving the item intact so it can be retried.
 */
export async function publishItem(item: RecoverableItem): Promise<void> {
  if (item.kind === "opfs") {
    await publishLocalRecording();
    return;
  }

  await publishDraft(item.draft);
}

/**
 * Permanently discards a recoverable item.
 */
export async function discardItem(item: RecoverableItem): Promise<void> {
  if (item.kind === "opfs") {
    await deviceStorage.deleteTimelapse();
    return;
  }

  const res = await api.draftTimelapse.delete({ id: item.id });
  if (!res.ok)
    throw new Error(res.message);
}
