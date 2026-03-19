import { useEffect } from "react";
import { useNavigate } from "react-router";
import { TitleBar } from "../components/TitleBar";
import { UploadProgress } from "../components/UploadProgress";
import { useUploadState } from "../hooks/useUploadState";
import { useIpcQuery } from "../hooks/useIpc";
import { lapse } from "../lib/desktop";

export function Upload() {
  const navigate = useNavigate();
  const {
    isUploading,
    progress,
    totalProgress,
    error,
    draftId,
    isComplete,
    startUpload,
    cancelUpload
  } = useUploadState();
  const { data: timelapse } = useIpcQuery("storage:get-timelapse");

  // Auto-start upload if there is a timelapse and we are not already uploading
  useEffect(() => {
    if (timelapse && !isUploading && !isComplete && !error) {
      startUpload();
    }
  }, [timelapse?.startedAt]);

  const handleViewTimelapse = () => {
    lapse.invoke("app:open-dashboard").catch(() => {});
  };

  const handleDeleteLocal = async () => {
    await lapse.invoke("storage:delete-timelapse");
    navigate("/");
  };

  const handleCancel = async () => {
    await cancelUpload();
    navigate("/");
  };

  return (
    <>
      <TitleBar />
      <main className="flex-1 overflow-y-auto bg-neutral-950 p-6">
        <h1 className="mb-6 text-lg font-bold text-white">Upload Timelapse</h1>

        {!timelapse && !isUploading && !isComplete ? (
          <div className="rounded-xl border border-dashed border-neutral-800 py-12 text-center">
            <p className="text-sm text-neutral-400">No timelapse to upload</p>
            <button
              type="button"
              onClick={() => navigate("/recording")}
              className="mt-4 rounded-lg bg-neutral-800 px-4 py-2 text-sm text-white transition-colors hover:bg-neutral-700"
            >
              Start Recording
            </button>
          </div>
        ) : isComplete ? (
          /* Success state */
          <div className="mx-auto max-w-md">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
              <div className="mb-4 flex justify-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20">
                  <svg
                    className="h-6 w-6 text-emerald-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
              <h2 className="text-lg font-bold text-white">Upload Complete</h2>
              <p className="mt-1 text-sm text-neutral-400">
                Your timelapse has been uploaded successfully
              </p>
              {draftId && (
                <p className="mt-2 text-xs text-neutral-500">Draft ID: {draftId}</p>
              )}

              <div className="mt-6 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={handleViewTimelapse}
                  className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
                >
                  View Timelapse
                </button>
                <button
                  type="button"
                  onClick={handleDeleteLocal}
                  className="rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm font-medium text-neutral-300 transition-colors hover:bg-neutral-700"
                >
                  Delete Local Files
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/")}
                  className="text-sm text-neutral-500 transition-colors hover:text-neutral-300"
                >
                  Back to Dashboard
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Upload in progress */
          <div className="mx-auto max-w-md space-y-6">
            <UploadProgress
              progress={progress}
              totalProgress={totalProgress}
              error={error}
              onRetry={startUpload}
            />

            {isUploading && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="text-sm text-neutral-500 transition-colors hover:text-neutral-300"
                >
                  Cancel Upload
                </button>
              </div>
            )}

            {error && !isUploading && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => navigate("/")}
                  className="text-sm text-neutral-500 transition-colors hover:text-neutral-300"
                >
                  Back to Dashboard
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
}
