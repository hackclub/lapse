import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import clsx from "clsx";
import Icon from "@hackclub/icons";
import { Skeleton } from "skullet/react";

import { api } from "@/api";
import { useAuth } from "@/hooks/useAuth";
import { formatDurationLong } from "@/components/Duration";
import RootLayout from "@/components/layout/RootLayout";
import { ErrorModal } from "@/components/layout/ErrorModal";
import { Button } from "@/components/ui/Button";
import { SAMPLE_ARCHIVED_DRAFTS, type ArchivedLookoutDraft } from "@/samples";

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

const READY_STATUSES = ["complete", "stopped", "compiling"];

function describe(draft: ArchivedLookoutDraft): string {
  if (draft.archivedReason === "session-gone")
    return `Lapse lost track of this ${timeAgo(draft.archivedAt)}`;

  return `Discarded ${timeAgo(draft.archivedAt)}`;
}

/**
 * Lookout recordings the user discarded (or that Lapse couldn't find on Lookout), with a way to bring each one back.
 * Restoring a finished recording goes straight to its publish page; an unfinished one returns to the drafts list,
 * where it can be continued.
 */
export function ArchivedRecordingsView() {
  const auth = useAuth(true);
  const router = useRouter();
  const [drafts, setDrafts] = useState<ArchivedLookoutDraft[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const userId = auth.currentUser?.id ?? null;

  const reload = useCallback(async () => {
    if (!userId)
      return;

    const res = await api.timelapse.getArchivedLookoutDrafts({});
    if (!res.ok) {
      setError(res.message);
      setDrafts([]);
      return;
    }

    setDrafts(res.data.drafts);
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function handleRestore(draft: ArchivedLookoutDraft) {
    setBusy(draft.id);

    try {
      const res = await api.timelapse.restoreLookoutDraft({ id: draft.id });
      if (!res.ok) {
        setError(res.message);
        return;
      }

      if (READY_STATUSES.includes(res.data.lookoutStatus)) {
        router.push(`/timelapse/publish/${res.data.draftId}`);
        return;
      }

      await reload();
    }
    finally {
      setBusy(null);
    }
  }

  return (
    <RootLayout showHeader title="Archived recordings">
      <div className="flex flex-col items-center px-6 sm:px-16 md:px-24 lg:px-32 py-8">
        <div className="flex flex-col gap-8 w-full max-w-3xl">
          <header className="flex items-center gap-4 w-full">
            <div className="p-2 border border-black rounded-md w-14 h-14 shrink-0 justify-center items-center flex">
              <Icon glyph="history" size={36} />
            </div>

            <div className="flex flex-col">
              <h1 className="font-bold text-2xl sm:text-3xl">Archived recordings</h1>
              <p className="text-muted sm:text-lg">
                Recordings you discarded end up here instead of being deleted. Restore one to publish it or keep
                recording.
              </p>
            </div>
          </header>

          {drafts !== null && drafts.length === 0 ? (
            <div className="flex flex-col items-center text-center gap-6 py-12">
              <Icon glyph="checkmark" size={64} className="text-green" />
              <div className="flex flex-col gap-1">
                <h2 className="font-bold text-xl">Nothing in here</h2>
                <p className="text-muted">You haven't discarded any recordings.</p>
              </div>
              <Button href="/" kind="primary" icon="home">Back to home</Button>
            </div>
          ) : (
            <Skeleton data={drafts} sample={SAMPLE_ARCHIVED_DRAFTS} label="Loading archived recordings">
              {items => (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {items.map(draft => {
                    const gone = draft.lookoutStatus === null;

                    return (
                      <div
                        key={draft.id}
                        className={clsx(
                          "flex flex-col items-center gap-3 p-4 w-full rounded-lg border border-slate overflow-hidden",
                          busy !== null && "opacity-50 pointer-events-none"
                        )}
                      >
                        {draft.thumbnailUrl ? (
                          <img src={draft.thumbnailUrl} alt="" className="w-full aspect-video rounded-md object-cover" />
                        ) : (
                          <div className="w-full aspect-video rounded-md bg-darker flex items-center justify-center">
                            <Icon glyph="clock-fill" size={48} className="text-muted" />
                          </div>
                        )}

                        <div className="flex flex-col items-center text-center gap-1">
                          <span className="font-bold">
                            {draft.trackedSeconds !== null ? formatDurationLong(draft.trackedSeconds) : "Unknown length"}
                          </span>
                          <span className="text-sm text-muted">
                            Recorded {timeAgo(draft.createdAt)} · {describe(draft)}
                          </span>
                        </div>

                        <button
                          onClick={() => handleRestore(draft)}
                          disabled={gone}
                          title={gone ? "Lookout doesn't seem to have this recording anymore" : undefined}
                          className="w-full bg-red hover:bg-red/90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-lg transition-colors cursor-pointer text-sm"
                        >
                          {busy === draft.id ? "Restoring..." : "Restore"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </Skeleton>
          )}
        </div>
      </div>

      <ErrorModal
        isOpen={!!error}
        setIsOpen={(open) => !open && setError(null)}
        message={error ?? ""}
        onClose={() => {}}
      />
    </RootLayout>
  );
}
