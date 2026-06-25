import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import Icon from "@hackclub/icons";
import type { DraftTimelapse } from "@hackclub/lapse-api";
import { decryptData, fromHex } from "@hackclub/lapse-shared";

import { deviceStorage } from "@/deviceStorage";
import { retryable, sfetch } from "@/safety";
import {
  type RecoverableItem,
  loadRecoverableItems,
  publishItem,
  discardItem,
} from "@/legacyRecovery";

import { Modal, ModalHeader, ModalContent } from "@/components/layout/Modal";
import { LoadingModal } from "@/components/layout/LoadingModal";
import { ErrorModal } from "@/components/layout/ErrorModal";

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Decrypts and renders a draft's preview thumbnail (or a placeholder when the key isn't on this device).
 */
function DraftThumbnail({ draft }: { draft: DraftTimelapse }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [missingKey, setMissingKey] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;

    retryable("recovery draft thumbnail", async () => {
      const device = await deviceStorage.getDevice(draft.deviceId);
      if (!device) {
        setMissingKey(true);
        return;
      }

      const res = await sfetch(draft.previewThumbnail);
      if (!res.ok)
        throw new Error(`HTTP ${res.status} while fetching draft thumbnail`);

      const decrypted = await decryptData(
        fromHex(device.passkey).buffer,
        fromHex(draft.iv).buffer,
        await res.arrayBuffer()
      );

      objectUrl = URL.createObjectURL(new Blob([decrypted], { type: "image/webp" }));
      setThumb(objectUrl);
    });

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [draft]);

  if (thumb)
    return <img src={thumb} alt="" className="w-full aspect-video rounded-md object-cover" />;

  return (
    <div className="w-full aspect-video rounded-md bg-darker flex items-center justify-center">
      <Icon glyph={missingKey ? "private" : "clock-fill"} size={48} className="text-muted" />
    </div>
  );
}

function ItemThumbnail({ item }: { item: RecoverableItem }) {
  if (item.kind === "draft")
    return <DraftThumbnail draft={item.draft} />;

  return (
    <div className="w-full aspect-video rounded-md bg-darker flex items-center justify-center">
      <Icon glyph="clock-fill" size={48} className="text-muted" />
    </div>
  );
}

/**
 * Lets the user recover legacy recordings - unfinished local (OPFS) recordings and uploaded-but-unpublished
 * drafts. The user selects which to keep (publish, as UNLISTED) or discard. Items are handled in batches and the
 * list refreshes after each action, so the user can return and deal with the rest later.
 */
export function LegacyRecoveryView({ userId, onDone }: {
  userId: string;
  onDone: () => void;
}) {
  const [items, setItems] = useState<RecoverableItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const next = await loadRecoverableItems(userId);
    setSelected(new Set());
    setItems(next);

    // Nothing left to recover - hand control back to the normal recording flow.
    if (next.length === 0)
      onDone();
  }, [userId, onDone]);

  useEffect(() => {
    reload();
  }, [reload]);

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runOnSelection(
    verb: "publish" | "discard",
    action: (item: RecoverableItem) => Promise<void>,
  ) {
    if (!items) return;

    const chosen = items.filter(i => selected.has(i.id));
    if (chosen.length === 0) return;

    const failures: string[] = [];

    for (const [i, item] of chosen.entries()) {
      setBusy(`${verb === "publish" ? "Publishing" : "Discarding"} ${i + 1} of ${chosen.length}...`);
      try {
        await action(item);
      }
      catch (err) {
        failures.push(err instanceof Error ? err.message : `Couldn't ${verb} an item.`);
      }
    }

    setBusy(null);

    if (failures.length > 0)
      setError(`Some items couldn't be ${verb === "publish" ? "published" : "discarded"}:\n${[...new Set(failures)].join("\n")}`);

    await reload();
  }

  function handleKeep() {
    return runOnSelection("publish", publishItem);
  }

  function handleDiscard() {
    if (!window.confirm("Discard the selected recordings? This cannot be undone."))
      return;

    return runOnSelection("discard", discardItem);
  }

  const selectionCount = selected.size;

  return (
    <Modal isOpen>
      <ModalHeader
        icon="history"
        showCloseButton
        onClose={onDone}
        title="Recover old recordings"
        description="These were recorded with an older version of Lapse. Pick the ones you want to keep - we'll publish them as unlisted - or discard the rest. You can come back to the others later."
        shortDescription="Keep or discard old recordings"
      />
      <ModalContent>
        {items === null ? (
          <p className="text-muted text-center">Looking for recordings...</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {items.map(item => {
                const isSelected = selected.has(item.id);
                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggle(item.id)}
                    onKeyDown={(e) => e.key === "Enter" && toggle(item.id)}
                    className={clsx(
                      "relative flex flex-col items-center gap-3 p-4 w-full rounded-lg border overflow-hidden cursor-pointer transition-colors",
                      isSelected ? "border-red bg-red/10" : "border-slate hover:bg-darkless",
                      busy !== null && "opacity-50 pointer-events-none"
                    )}
                  >
                    <div className={clsx(
                      "absolute top-2 right-2 z-10 w-6 h-6 rounded-full border flex items-center justify-center",
                      isSelected ? "bg-red border-red" : "bg-dark/80 border-slate"
                    )}>
                      {isSelected && <Icon glyph="checkmark" size={20} className="text-white" />}
                    </div>

                    <ItemThumbnail item={item} />

                    <div className="flex flex-col items-center text-center gap-1">
                      <span className="font-bold">
                        {item.kind === "opfs" ? "Unfinished recording" : (item.draft.name ?? "Untitled draft")}
                      </span>
                      <span className="text-sm text-muted">
                        {item.kind === "opfs" ? "On this device" : "Uploaded"} · {timeAgo(item.createdAt)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2 w-full">
              <button
                onClick={handleKeep}
                disabled={selectionCount === 0}
                className="flex-1 bg-red hover:bg-red/90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-lg transition-colors cursor-pointer text-sm"
              >
                Keep{selectionCount > 0 ? ` (${selectionCount})` : ""}
              </button>
              <button
                onClick={handleDiscard}
                disabled={selectionCount === 0}
                className="flex-1 border border-red text-red hover:bg-red/10 disabled:opacity-50 disabled:cursor-not-allowed font-bold py-2 px-4 rounded-lg transition-colors cursor-pointer text-sm"
              >
                Discard{selectionCount > 0 ? ` (${selectionCount})` : ""}
              </button>
            </div>

            <button
              onClick={onDone}
              className="text-muted hover:text-white text-sm transition-colors cursor-pointer"
            >
              Not now
            </button>
          </div>
        )}
      </ModalContent>

      <LoadingModal isOpen={busy !== null} title="Working" message={busy ?? ""} />

      <ErrorModal
        isOpen={!!error}
        setIsOpen={(open) => !open && setError(null)}
        message={error ?? ""}
        onClose={() => {}}
      />
    </Modal>
  );
}
