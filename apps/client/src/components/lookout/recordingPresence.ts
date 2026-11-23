/**
 * Lets other tabs in this browser tell a recording that is still running apart from one whose tab is gone.
 *
 * Lookout only knows a session is "active" until it has gone ten minutes without a screenshot, so on its own the
 * home page can't offer to resume a recording without risking cutting short one that is live in another tab. The
 * recorder holds a Web Lock for as long as it is mounted, and the browser drops it the moment that tab closes or
 * crashes - so an active draft recorded here with nobody holding its lock has certainly been abandoned.
 */

const LOCK_PREFIX = "lapse:recording:";

function lockName(draftId: string): string {
  return `${LOCK_PREFIX}${draftId}`;
}

function locksApi(): LockManager | null {
  if (typeof navigator === "undefined" || !("locks" in navigator))
    return null;

  return navigator.locks;
}

/** Holds the draft's lock until the returned function is called. Does nothing in browsers without Web Locks. */
export function holdRecordingLock(draftId: string): () => void {
  const locks = locksApi();
  if (!locks)
    return () => {};

  let release: () => void = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });

  locks.request(lockName(draftId), () => held)
    .catch((err: unknown) => console.warn("(recordingPresence) couldn't hold the recording lock", err));

  return release;
}

/**
 * The drafts some tab in this browser is recording right now, or `null` when the browser can't say - in which case
 * nothing should be treated as abandoned.
 */
export async function draftsRecordingHere(): Promise<Set<string> | null> {
  const locks = locksApi();
  if (!locks)
    return null;

  try {
    const snapshot = await locks.query();
    const names = [...(snapshot.held ?? []), ...(snapshot.pending ?? [])]
      .map(lock => lock.name)
      .filter((name): name is string => typeof name === "string" && name.startsWith(LOCK_PREFIX))
      .map(name => name.slice(LOCK_PREFIX.length));

    return new Set(names);
  }
  catch {
    return null;
  }
}

/**
 * Pauses the session while the page is going away. `sendBeacon` is the one request a browser will still send from a
 * closing tab, though even it isn't guaranteed - which is why the lock above is what other tabs actually rely on.
 */
export function pauseSessionOnExit(apiBaseUrl: string, lookoutToken: string): boolean {
  if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function")
    return false;

  return navigator.sendBeacon(`${apiBaseUrl}/api/sessions/${lookoutToken}/pause`);
}

/** Pauses a session from another tab, so it can be resumed or finished like any other paused recording. */
export async function pauseSession(apiBaseUrl: string, lookoutToken: string): Promise<boolean> {
  const res = await fetch(`${apiBaseUrl}/api/sessions/${lookoutToken}/pause`, { method: "POST" });
  return res.ok;
}
