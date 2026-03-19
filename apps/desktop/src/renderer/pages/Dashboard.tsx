import { useNavigate } from "react-router";
import { TitleBar } from "../components/TitleBar";
import { TimelapseCard } from "../components/TimelapseCard";
import { useAuth } from "../context/AuthContext";
import { useRecordingState } from "../hooks/useRecordingState";
import { useIpcQuery } from "../hooks/useIpc";

export function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isRecording, isPaused, formattedTime, statusLabel, statusColor } = useRecordingState();
  const { data: timelapse } = useIpcQuery("storage:get-timelapse");

  const isActive = isRecording || isPaused;

  return (
    <>
      <TitleBar />
      <main className="flex-1 overflow-y-auto bg-neutral-950 p-6">
        {/* Welcome */}
        <div className="mb-8">
          <h1 className="text-xl font-bold text-white">
            Welcome back{user?.displayName ? `, ${user.displayName}` : ""}
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            {isActive ? (
              <span className={statusColor}>
                {statusLabel} &mdash; {formattedTime}
              </span>
            ) : (
              "Ready to start a new timelapse"
            )}
          </p>
        </div>

        {/* CTA */}
        <div className="mb-8">
          {isActive ? (
            <button
              type="button"
              onClick={() => navigate("/recording")}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-red-500"
            >
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
              </span>
              View Recording
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate("/recording")}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-red-500"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
              </svg>
              Start Recording
            </button>
          )}
        </div>

        {/* Recent timelapses */}
        <section>
          <h2 className="mb-4 text-sm font-medium text-neutral-300">Current Timelapse</h2>
          {timelapse ? (
            <div className="space-y-3">
              <TimelapseCard
                title={`Timelapse — ${new Date(timelapse.startedAt).toLocaleDateString()}`}
                duration={Date.now() - timelapse.startedAt}
                snapshotCount={timelapse.snapshots.length}
                startedAt={timelapse.startedAt}
                onClick={() => navigate("/upload")}
              />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-neutral-800 py-8 text-center">
              <p className="text-sm text-neutral-500">No timelapses yet</p>
              <p className="mt-1 text-xs text-neutral-600">
                Start recording to create your first timelapse
              </p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
