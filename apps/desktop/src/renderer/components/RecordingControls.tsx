import { useRecording } from "../context/RecordingContext";
import { useRecordingState } from "../hooks/useRecordingState";

export function RecordingControls() {
  const { stopRecording, pauseRecording, resumeRecording } = useRecording();
  const { isRecording, isPaused, formattedTime, snapshotCount, statusLabel, statusColor } =
    useRecordingState();

  const isActive = isRecording || isPaused;

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Status indicator */}
      <div className="flex items-center gap-3">
        {isRecording && (
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
          </span>
        )}
        {isPaused && <span className="inline-flex h-3 w-3 rounded-full bg-amber-500" />}
        <span className={`text-sm font-medium ${statusColor}`}>{statusLabel}</span>
      </div>

      {/* Timer */}
      {isActive && (
        <div className="text-center">
          <p className="font-mono text-4xl font-bold text-white">{formattedTime}</p>
          <p className="mt-1 text-sm text-neutral-400">
            {snapshotCount} snapshot{snapshotCount !== 1 ? "s" : ""} captured
          </p>
        </div>
      )}

      {/* Controls */}
      {isActive && (
        <div className="flex items-center gap-4">
          {isRecording ? (
            <button
              type="button"
              onClick={pauseRecording}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-800 text-amber-500 transition-colors hover:bg-neutral-700"
              title="Pause"
            >
              <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={resumeRecording}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-800 text-emerald-500 transition-colors hover:bg-neutral-700"
              title="Resume"
            >
              <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          )}

          <button
            type="button"
            onClick={stopRecording}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-500"
            title="Stop"
          >
            <svg className="h-7 w-7" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
