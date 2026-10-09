import { useSyncExternalStore } from "react";

function extractDateComponents(seconds: number) {
  seconds = Math.floor(seconds);

  const years = Math.floor(seconds / 31557600); // 365.25 days
  seconds %= 31557600;

  const months = Math.floor(seconds / 2629746); // ~30.44 days
  seconds %= 2629746;

  const weeks = Math.floor(seconds / 604800);
  seconds %= 604800;

  const days = Math.floor(seconds / 86400);
  seconds %= 86400;

  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;

  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  return {
    y: years,
    mo: months,
    w: weeks,
    d: days,
    h: hours,
    m: minutes,
    s: seconds
  };
}

function formatTimeElapsed(date: Date, now: number) {
  const secondsPast = (now - date.getTime()) / 1000;

  // Every component is the remainder of the one above it - weeks have to be spelled out, or three weeks ago would
  // read as "6 days ago".
  const { y, mo, w, d, h, m, s } = extractDateComponents(secondsPast);

  return (
    (y >= 1) ? `${y} year${y > 1 ? 's' : ''} ago` :
    (mo >= 1) ? `${mo} month${mo > 1 ? 's' : ''} ago` :
    (w >= 1) ? `${w} week${w > 1 ? 's' : ''} ago` :
    (d >= 1) ? `${d} day${d > 1 ? 's' : ''} ago` :
    (h >= 1) ? `${h} hour${h > 1 ? 's' : ''} ago` :
    (m >= 1) ? `${m} minute${m > 1 ? 's' : ''} ago` :
    (s <= 1) ? "just now" :
    `${s} second${s > 1 ? 's' : ''} ago`
  );
}

function formatExactDate(date: Date) {
  return date.toLocaleDateString("en-us", {
    day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "numeric"
  });
}

/**
 * A clock shared by every elapsed-time label on the page, so that a list of a hundred of them keeps one timer
 * between them rather than a hundred. The snapshot only ever changes on a tick, as `useSyncExternalStore` requires.
 */
const CLOCK_INTERVAL_MS = 10 * 1000;

const clockListeners = new Set<() => void>();
let clockNow: number | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;

function subscribeToClock(onStoreChange: () => void) {
  clockListeners.add(onStoreChange);

  clockTimer ??= setInterval(() => {
    clockNow = Date.now();

    for (const listener of clockListeners) {
      listener();
    }
  }, CLOCK_INTERVAL_MS);

  return () => {
    clockListeners.delete(onStoreChange);

    if (clockListeners.size === 0 && clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

function getClockSnapshot() {
  clockNow ??= Date.now();
  return clockNow;
}

/**
 * There is no meaningful "now" while server-rendering - whatever we picked would be stale by the time anyone read
 * it. Returning `null` is how a label knows to fall back to an absolute date.
 */
function getServerClockSnapshot(): number | null {
  return null;
}

export function TimeAgo({ date, className }: {
  date: Date | number;
  className?: string;
}) {
  const timestamp = typeof date === "number" ? date : date.getTime();
  const exact = new Date(timestamp);

  /*
    Neither of the two things we could render survives SSR on its own: "3 hours ago" depends on when the page is
    being looked at, and an exact date is formatted in whatever timezone the renderer happens to be in - the
    server's, which is rarely the reader's.

    Hence the clock: it reads as `null` while server-rendering *and* through hydration, so both sides render the
    same shape of thing and React re-renders with the real clock the moment hydration is over. The two absolute
    dates can still disagree - they're written in different timezones - which is what the suppression below is for;
    the re-render replaces the text with elapsed time regardless.

    Labels that were never server-rendered - cards fetched client-side, say - get the real clock on their very
    first render, and so never flash an absolute date at anyone.
  */
  const now = useSyncExternalStore(subscribeToClock, getClockSnapshot, getServerClockSnapshot);

  return (
    <time
      // Always UTC, and so identical on both sides of the wire.
      dateTime={exact.toISOString()}
      title={now === null ? undefined : formatExactDate(exact)}
      className={className}
      suppressHydrationWarning
    >
      {now === null ? formatExactDate(exact) : formatTimeElapsed(exact, now)}
    </time>
  );
}