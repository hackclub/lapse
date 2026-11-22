import type { NextRouter } from "next/router";

/** Lookout stops (and compiles) a session on its own once it has gone this long without a screenshot. */
const AUTO_STOP_AFTER_MS = 24 * 60 * 60 * 1000;

export type PausedDraft = {
  id: string;
  createdAt: number;
  trackedSeconds: number;
  /** When Lookout will finish the recording by itself if nobody touches it. */
  autoStopsAt: number | null;
  recordedOnDesktop: boolean;
  lookoutToken: string;
  lookoutSessionId: string;
  lookoutApiBaseUrl: string;
};

export function autoStopTime(lastCapturedAt: number | null): number | null {
  return lastCapturedAt === null ? null : lastCapturedAt + AUTO_STOP_AFTER_MS;
}

export function formatTrackedTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
}

/** "in 19h", "in 25min" - how long until a paused recording finishes by itself. */
export function formatTimeUntil(timestamp: number): string {
  const minutes = Math.max(1, Math.round((timestamp - Date.now()) / 60_000));
  if (minutes < 60)
    return `in ${minutes}min`;

  return `in ${Math.round(minutes / 60)}h`;
}

/**
 * Stops a paused recording so Lookout compiles it, then sends the user to publish it - what they would otherwise
 * wait a day of inactivity for. A 409 means the session already stopped (another tab, the auto-stop), which is
 * just as good.
 */
export async function finishPausedDraft(draft: PausedDraft, router: NextRouter): Promise<void> {
  const res = await fetch(`${draft.lookoutApiBaseUrl}/api/sessions/${draft.lookoutToken}/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  if (!res.ok && res.status !== 409)
    throw new Error(`Couldn't finish the recording (Lookout said ${res.status}).`);

  await router.push(`/timelapse/publish/${draft.id}`);
}

const DISMISSED_KEY = "lapse:dismissedPausedNotices";

export function getDismissedPausedNotices(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
  }
  catch {
    return [];
  }
}

export function dismissPausedNotice(draftId: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...getDismissedPausedNotices(), draftId]));
  }
  catch {
    // Private mode and the like: the notice just comes back next time.
  }
}
