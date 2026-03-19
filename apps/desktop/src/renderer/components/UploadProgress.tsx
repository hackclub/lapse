import type { UploadProgress as UploadProgressData } from "@/shared/ipc-channels";

interface UploadProgressProps {
  progress: Map<string, UploadProgressData>;
  totalProgress: number;
  error: string | null;
  onRetry: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

export function UploadProgress({ progress, totalProgress, error, onRetry }: UploadProgressProps) {
  const sessions = Array.from(progress.entries());

  return (
    <div className="space-y-4">
      {/* Overall progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-neutral-300">Overall progress</span>
          <span className="text-sm tabular-nums text-neutral-400">{totalProgress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-neutral-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${totalProgress}%` }}
          />
        </div>
      </div>

      {/* Per-session progress */}
      {sessions.length > 0 && (
        <div className="space-y-3">
          {sessions.map(([sessionId, data]) => {
            const pct = data.bytesTotal > 0
              ? Math.round((data.bytesUploaded / data.bytesTotal) * 100)
              : 0;
            return (
              <div key={sessionId} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="truncate text-xs text-neutral-400">
                    Session {sessionId.slice(0, 8)}
                  </span>
                  <span className="text-xs tabular-nums text-neutral-500">
                    {formatBytes(data.bytesUploaded)} / {formatBytes(data.bytesTotal)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
                  <div
                    className="h-full rounded-full bg-emerald-500/70 transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
