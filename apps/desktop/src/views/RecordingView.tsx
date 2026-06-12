import { Pause, Play, Square } from "lucide-react";

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
    <div className="flex flex-col h-full bg-black animate-in">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#35353B] border-b border-white/10">
        <div className="flex items-center gap-2">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              isPaused ? "bg-yellow" : "bg-red animate-pulse"
            }`}
          />
          <span className="text-xs font-medium text-muted">
            {isPaused ? "Paused" : "Recording"}
          </span>
        </div>
        <div className="text-sm font-bold font-mono tabular-nums">
          {formatTime(elapsed)}
        </div>
      </div>

      {/* Preview */}
      <div className="flex-1 min-h-0 flex items-center justify-center">
        {latestFrameUrl ? (
          <img
            src={latestFrameUrl}
            alt="Preview"
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <div className="text-muted text-sm">Waiting for first frame...</div>
        )}
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-center gap-3 px-4 py-3 bg-[#35353B] border-t border-white/10">
        <button
          onClick={isPaused ? onResume : onPause}
          className="cursor-pointer flex items-center gap-2 px-5 py-2 rounded-lg border border-white/20 text-sm font-medium hover:bg-white/10 transition-colors"
          title={isPaused ? "Resume" : "Pause"}
        >
          {isPaused ? <Play size={14} /> : <Pause size={14} />}
          {isPaused ? "Resume" : "Pause"}
        </button>
        <button
          onClick={onStop}
          className="cursor-pointer flex items-center gap-2 px-5 py-2 rounded-lg bg-red text-white text-sm font-medium hover:brightness-110 transition-all"
          title="Stop"
        >
          <Square size={12} fill="white" />
          Stop
        </button>
      </div>
    </div>
  );
}
