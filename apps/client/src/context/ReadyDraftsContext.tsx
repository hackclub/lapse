import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/router";

import { api } from "@/api";
import { useAuthContext } from "@/context/AuthContext";
import { showReadyToPublishToast } from "@/components/lookout/ReadyToPublishToast";

export type ReadyDraft = {
  id: string;
  createdAt: number;
  thumbnailUrl: string | null;
  /** Lookout is still building the video. It can be published already; the timelapse appears once it lands. */
  compiling: boolean;
};

const READY_STATUSES = new Set(["stopped", "compiling", "complete"]);

/** Already publishing, recording, signing in, embedded in the Lookout desktop app - or the home page, which lists them itself. */
const NO_TOAST_ON = ["/timelapse/publish", "/timelapse/create", "/timelapse/handoff", "/lookout/", "/auth", "/oauth/"];

const TOASTED_KEY = "lapse:readyToasted";

/** Each recording gets one toast per browser session. Dismissing it means "not now", not "ask again on the next page". */
function takeUntoasted(drafts: ReadyDraft[]): ReadyDraft[] {
  let toasted: string[] = [];
  try {
    toasted = JSON.parse(sessionStorage.getItem(TOASTED_KEY) ?? "[]");
  }
  catch {
    toasted = [];
  }

  const fresh = drafts.filter(d => !toasted.includes(d.id));
  if (fresh.length > 0) {
    try {
      sessionStorage.setItem(TOASTED_KEY, JSON.stringify([...toasted, ...fresh.map(d => d.id)]));
    }
    catch {
      // Private mode and the like: worst case the toast shows again on the next page.
    }
  }

  return fresh;
}

const ReadyDraftsContext = createContext<ReadyDraft[] | null>(null);

/**
 * Keeps track of the signed-in user's recordings that are done but unpublished, refreshed on every navigation. The
 * home page lists them; everywhere else, a new one gets a toast.
 */
export function ReadyDraftsProvider({ children }: {
  children: ReactNode;
}) {
  const router = useRouter();
  const { currentUser, isLoading } = useAuthContext();
  const [drafts, setDrafts] = useState<ReadyDraft[] | null>(null);

  const path = router.pathname;

  useEffect(() => {
    // Wait for the session to be confirmed: probing with a stale token would trip the global 401 redirect.
    if (isLoading || !currentUser || path.startsWith("/auth") || path.startsWith("/oauth/") || path.startsWith("/lookout/"))
      return;

    let cancelled = false;
    api.timelapse.getLookoutDrafts({})
      .then(res => {
        if (cancelled || !res.ok)
          return;

        const ready = res.data.drafts
          .filter(d => READY_STATUSES.has(d.lookoutStatus))
          .sort((a, b) => a.createdAt - b.createdAt)
          .map(d => ({
            id: d.id,
            createdAt: d.createdAt,
            thumbnailUrl: d.thumbnailUrl,
            compiling: d.lookoutStatus !== "complete",
          }));

        setDrafts(ready);

        if (path !== "/" && !NO_TOAST_ON.some(p => path.startsWith(p))) {
          const fresh = takeUntoasted(ready);
          if (fresh.length > 0)
            showReadyToPublishToast(ready, router);
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [path, currentUser, isLoading]);

  return (
    <ReadyDraftsContext.Provider value={currentUser ? drafts : null}>
      {children}
    </ReadyDraftsContext.Provider>
  );
}

/** Ready-to-publish recordings, oldest first. `null` until known, or when signed out. */
export function useReadyDrafts(): ReadyDraft[] | null {
  return useContext(ReadyDraftsContext);
}
