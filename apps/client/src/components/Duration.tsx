/**
 * Formats a number of seconds as a clock reading (`1:02:03`), the way a video player writes a position.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    seconds = 0;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  else if (minutes > 0) {
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  }
  else {
    return `0:${String(secs).padStart(2, '0')}`;
  }
}

/**
 * Formats a number of seconds as a spelled-out span (`2h 34m`). Used for amounts of time that aren't positions in a
 * video - a clock reading of the hours someone worked reads like a timestamp, which is exactly what it isn't.
 */
export function formatDurationLong(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    seconds = 0;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  else if (minutes > 0) {
    return `${minutes}m`;
  }
  else {
    return `${secs}s`;
  }
}

export function Duration({ seconds, format = "clock", className }: {
  seconds: number;
  format?: "clock" | "long";
  className?: string;
}) {
  const display = format === "long" ? formatDurationLong(seconds) : formatDuration(seconds);

  return (
    <div className={`inline-flex items-center gap-1 ${className || ""}`}>
      <time>{display}</time>
    </div>
  );
}
