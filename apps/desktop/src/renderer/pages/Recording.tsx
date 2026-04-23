import { useState } from "react";
import { useNavigate } from "react-router";
import { TitleBar } from "../components/TitleBar";
import { SourcePicker } from "../components/SourcePicker";
import { RecordingControls } from "../components/RecordingControls";
import { useRecording } from "../context/RecordingContext";
import { useRecordingState } from "../hooks/useRecordingState";
import { useIpcQuery } from "../hooks/useIpc";
import type { DesktopSource } from "@/shared/ipc-channels";

export function Recording() {
  const navigate = useNavigate();
  const { startRecording, stopRecording } = useRecording();
  const { isIdle, isRecording, isPaused, formattedTime, snapshotCount, sourceName } =
    useRecordingState();
  const { data: videoSize } = useIpcQuery("storage:get-video-size");

  const [selectedSource, setSelectedSource] = useState<DesktopSource | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const isActive = isRecording || isPaused;

  const handleStart = async () => {
    if (!selectedSource) return;
    setIsStarting(true);
    try {
      await startRecording(selectedSource.id);
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async () => {
    await stopRecording();
    navigate("/upload");
  };

  function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
  }

  return (
    <>
      <TitleBar />
      <main className="flex-1 overflow-y-auto bg-neutral-950 p-6">
        {isIdle ? (
          <>
            {/* Source picker */}
            <div className="mb-6">
              <h1 className="mb-4 text-lg font-bold text-white">New Recording</h1>
              <SourcePicker
                selectedId={selectedSource?.id ?? null}
                onSelect={setSelectedSource}
              />
            </div>

            {/* Start button */}
            <div className="flex justify-center">
              <button
                type="button"
                onClick={handleStart}
                disabled={!selectedSource || isStarting}
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-8 py-3 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isStarting ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Starting...
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" />
                    </svg>
                    Start Recording
                  </>
                )}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Active recording */}
            <div className="mb-8 text-center">
              <h1 className="text-lg font-bold text-white">
                Recording{sourceName ? ` — ${sourceName}` : ""}
              </h1>
            </div>

            <RecordingControls />

            {/* Live stats */}
            <div className="mx-auto mt-8 grid max-w-md grid-cols-3 gap-4">
              <div className="rounded-xl bg-neutral-800 p-4 text-center">
                <p className="text-xs text-neutral-400">Duration</p>
                <p className="mt-1 font-mono text-lg font-bold text-white">{formattedTime}</p>
              </div>
              <div className="rounded-xl bg-neutral-800 p-4 text-center">
                <p className="text-xs text-neutral-400">Snapshots</p>
                <p className="mt-1 font-mono text-lg font-bold text-white">{snapshotCount}</p>
              </div>
              <div className="rounded-xl bg-neutral-800 p-4 text-center">
                <p className="text-xs text-neutral-400">File Size</p>
                <p className="mt-1 font-mono text-lg font-bold text-white">
                  {videoSize != null ? formatBytes(videoSize) : "--"}
                </p>
              </div>
            </div>

            {/* Stop and go to upload */}
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={handleStop}
                className="inline-flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-800 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
              >
                <svg className="h-4 w-4 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
                Stop &amp; Upload
              </button>
            </div>
          </>
        )}
      </main>
    </>
  );
}
