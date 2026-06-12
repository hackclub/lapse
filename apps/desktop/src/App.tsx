import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

import { useAuth } from "./hooks/useAuth";
import { useRecording } from "./hooks/useRecording";
import { uploadTimelapse, UploadProgress } from "./upload";
import { api } from "./api";

import { LoginView } from "./views/LoginView";
import { SetupView } from "./views/SetupView";
import { RecordingView } from "./views/RecordingView";
import { EncodingView } from "./views/EncodingView";
import { UploadView } from "./views/UploadView";
import { PublishView } from "./views/PublishView";
import { DoneView } from "./views/DoneView";

type AppView =
  | { kind: "setup" }
  | { kind: "recording" }
  | {
      kind: "encoding";
      sessionId: string;
      frameCount: number;
      snapshots: number[];
    }
  | {
      kind: "uploading";
      sessionId: string;
      outputPath: string;
      thumbnailPath: string;
      snapshots: number[];
    }
  | { kind: "publish"; draftId: string; devicePasskey: string; sessionId: string }
  | { kind: "done"; timelapseId: string }
  | { kind: "error"; message: string };

function App() {
  const auth = useAuth();
  const recording = useRecording();
  const [view, setView] = useState<AppView>({ kind: "setup" });
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({
    stage: "",
    progress: 0,
  });
  const [publishError, setPublishError] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  const handleStart = useCallback(
    async (sources: { id: string; kind: string; name: string }[]) => {
      await recording.start(sources);
      setView({ kind: "recording" });
    },
    [recording]
  );

  const handleStop = useCallback(async () => {
    const result = await recording.stop();
    setView({
      kind: "encoding",
      sessionId: result.session_id,
      frameCount: result.frame_count,
      snapshots: result.snapshots,
    });

    try {
      const encoded = await invoke<{
        output_path: string;
        thumbnail_path: string;
        file_size: number;
        thumbnail_size: number;
        frame_count: number;
      }>("encode_session", { sessionId: result.session_id });

      setView({
        kind: "uploading",
        sessionId: result.session_id,
        outputPath: encoded.output_path,
        thumbnailPath: encoded.thumbnail_path,
        snapshots: result.snapshots,
      });

      const uploadResult = await uploadTimelapse({
        outputPath: encoded.output_path,
        thumbnailPath: encoded.thumbnail_path,
        snapshots: result.snapshots,
        onProgress: setUploadProgress,
      });

      setView({
        kind: "publish",
        draftId: uploadResult.draftId,
        devicePasskey: uploadResult.devicePasskey,
        sessionId: result.session_id,
      });
    } catch (e) {
      console.error("Encoding/upload failed:", e);
      const message = e instanceof Error ? e.message : typeof e === "string" ? e : "An unknown error occurred";
      setView({ kind: "error", message });
    }
  }, [recording]);

  const handlePublish = useCallback(
    async (name: string, description: string, visibility: string) => {
      if (view.kind !== "publish") return;

      setIsPublishing(true);
      setPublishError(null);

      try {
        // Update draft with metadata
        await api.draftTimelapse.update({
          id: view.draftId,
          changes: { name, description, editList: [] },
        });

        const res = await api.timelapse.publish({
          id: view.draftId,
          visibility: visibility as "PUBLIC" | "UNLISTED",
          deviceKey: view.devicePasskey,
        });

        if (!res.ok) {
          throw new Error(res.message || "Publish failed");
        }

        const timelapseId = res.data.timelapse.id;

        await invoke("cleanup_session", { sessionId: view.sessionId });
        await openUrl(`https://lapse.hackclub.com/timelapse/${timelapseId}`);

        setView({ kind: "done", timelapseId });
      } catch (e) {
        setPublishError(e instanceof Error ? e.message : "Publish failed");
      } finally {
        setIsPublishing(false);
      }
    },
    [view]
  );

  if (auth.isLoading) {
    return (
      <div className="flex items-center justify-center h-screen text-muted text-sm">
        Loading...
      </div>
    );
  }

  if (!auth.token) {
    return (
      <LoginView
        isLoggingIn={auth.isLoggingIn}
        error={auth.error}
        onLogin={auth.login}
      />
    );
  }

  switch (view.kind) {
    case "setup":
      return (
        <SetupView
          user={auth.user ? {
            displayName: auth.user.displayName,
            handle: auth.user.handle,
            profilePictureUrl: auth.user.profilePictureUrl,
          } : null}
          onStart={handleStart}
          onLogout={auth.logout}
        />
      );

    case "recording":
      return (
        <RecordingView
          phase={recording.phase as "Recording" | "Paused"}
          elapsed={recording.elapsed}
          latestFrameUrl={recording.latestFrameUrl}
          onPause={recording.pause}
          onResume={recording.resume}
          onStop={handleStop}
        />
      );

    case "encoding":
      return <EncodingView frameCount={view.frameCount} />;

    case "uploading":
      return <UploadView progress={uploadProgress} />;

    case "publish":
      return (
        <PublishView
          onPublish={handlePublish}
          isPublishing={isPublishing}
          error={publishError}
        />
      );

    case "done":
      return (
        <DoneView
          timelapseId={view.timelapseId}
          onRecordAnother={() => setView({ kind: "setup" })}
        />
      );

    case "error":
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
          <h2 className="text-xl font-semibold text-red">Something went wrong</h2>
          <p className="text-sm text-muted text-center max-w-md">{view.message}</p>
          <button
            onClick={() => setView({ kind: "setup" })}
            className="mt-4 px-6 py-2.5 bg-white/10 text-white text-sm font-medium rounded-lg hover:bg-white/20 transition-colors"
          >
            Back to Setup
          </button>
        </div>
      );
  }
}

export default App;
