interface RecordingViewProps {
  phase: "Recording" | "Paused";
  elapsed: number;
  latestFrameUrl: string | null;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((n) => n.toString().padStart(2, "0")).join(":");
}

export function RecordingView({
  phase,
  elapsed,
  latestFrameUrl,
  onPause,
  onResume,
  onStop,
}: RecordingViewProps) {
  const isPaused = phase === "Paused";

  return (
    <div className="flex h-full">
      {/* Left panel - Controls */}
      <div className="w-[280px] flex flex-col border-r border-white/10 p-5">
        {/* Recording indicator */}
        <div className="flex items-center gap-2 mb-6">
          <div
            className={`w-3 h-3 rounded-full ${
              isPaused ? "bg-yellow" : "bg-red animate-pulse"
            }`}
          />
          <span className="text-sm font-medium">
            {isPaused ? "Paused" : "Recording"}
          </span>
        </div>

        {/* Timer */}
        <div className="text-4xl font-bold font-mono mb-8">
          {formatTime(elapsed)}
        </div>

        {/* Controls */}
        <div className="flex gap-3 mt-auto">
          <button
            onClick={isPaused ? onResume : onPause}
            className="flex-1 py-2.5 rounded-lg border border-white/20 text-sm font-medium hover:bg-white/10 transition-colors"
          >
            {isPaused ? "Resume" : "Pause"}
          </button>
          <button
            onClick={onStop}
            className="flex-1 py-2.5 rounded-lg bg-red text-white text-sm font-medium hover:brightness-110 transition-all"
          >
            Stop
          </button>
        </div>
      </div>

      {/* Right panel - Preview */}
      <div className="flex-1 flex items-center justify-center p-4 bg-black/30">
        {latestFrameUrl ? (
          <img
            src={latestFrameUrl}
            alt="Preview"
            className="max-w-full max-h-full object-contain rounded-lg"
          />
        ) : (
          <div className="text-muted text-sm">Waiting for first frame...</div>
        )}
      </div>
    </div>
  );
}
