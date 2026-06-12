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
import { PublishView } from "./views/PublishView";
import { DoneView } from "./views/DoneView";

interface StashedTimelapse {
  session_id: string;
  created_at: number;
  frame_count: number;
  elapsed_seconds: number;
  output_path: string;
  thumbnail_path: string;
  snapshots: number[];
}

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
      kind: "publish";
      sessionId: string;
      outputPath: string;
      thumbnailPath: string;
      frameCount: number;
      elapsedSeconds: number;
      snapshots: number[];
    }
  | { kind: "done"; timelapseId: string }
  | { kind: "error"; message: string };

function App() {
  const auth = useAuth();
  const recording = useRecording();
  const [view, setView] = useState<AppView>({ kind: "setup" });
  const [publishError, setPublishError] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishProgress, setPublishProgress] = useState<UploadProgress | null>(
    null
  );

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
        kind: "publish",
        sessionId: result.session_id,
        outputPath: encoded.output_path,
        thumbnailPath: encoded.thumbnail_path,
        frameCount: encoded.frame_count,
        elapsedSeconds: result.elapsed_seconds,
        snapshots: result.snapshots,
      });
    } catch (e) {
      console.error("Encoding failed:", e);
      const message =
        e instanceof Error
          ? e.message
          : typeof e === "string"
            ? e
            : "An unknown error occurred";
      setView({ kind: "error", message });
    }
  }, [recording]);

  const handleStash = useCallback(async () => {
    if (view.kind !== "publish") return;
    try {
      await invoke("stash_save", {
        stash: {
          session_id: view.sessionId,
          created_at: Date.now(),
          frame_count: view.frameCount,
          elapsed_seconds: view.elapsedSeconds,
          output_path: view.outputPath,
          thumbnail_path: view.thumbnailPath,
          snapshots: view.snapshots,
        },
      });
      setView({ kind: "setup" });
    } catch (e) {
      console.error("Stash failed:", e);
    }
  }, [view]);

  const handleResumeStash = useCallback((stash: StashedTimelapse) => {
    setView({
      kind: "publish",
      sessionId: stash.session_id,
      outputPath: stash.output_path,
      thumbnailPath: stash.thumbnail_path,
      frameCount: stash.frame_count,
      elapsedSeconds: stash.elapsed_seconds,
      snapshots: stash.snapshots,
    });
  }, []);

  const handlePublish = useCallback(
    async (name: string, description: string, visibility: string) => {
      if (view.kind !== "publish") return;

      setIsPublishing(true);
      setPublishError(null);
      setPublishProgress({ stage: "Uploading...", progress: 0 });

      try {
        const uploadResult = await uploadTimelapse({
          outputPath: view.outputPath,
          thumbnailPath: view.thumbnailPath,
          snapshots: view.snapshots,
          onProgress: setPublishProgress,
        });

        setPublishProgress({ stage: "Publishing...", progress: 1 });

        await api.draftTimelapse.update({
          id: uploadResult.draftId,
          changes: { name, description, editList: [] },
        });

        const res = await api.timelapse.publish({
          id: uploadResult.draftId,
          visibility: visibility as "PUBLIC" | "UNLISTED",
          deviceKey: uploadResult.devicePasskey,
        });

        if (!res.ok) {
          throw new Error(res.message || "Publish failed");
        }

        const timelapseId = res.data.timelapse.id;

        await invoke("cleanup_session", { sessionId: view.sessionId });
        await invoke("stash_remove", { sessionId: view.sessionId });
        await openUrl(`https://lapse.hackclub.com/timelapse/${timelapseId}`);

        setView({ kind: "done", timelapseId });
      } catch (e) {
        setPublishError(e instanceof Error ? e.message : "Publish failed");
      } finally {
        setIsPublishing(false);
        setPublishProgress(null);
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
          user={
            auth.user
              ? {
                  displayName: auth.user.displayName,
                  handle: auth.user.handle,
                  profilePictureUrl: auth.user.profilePictureUrl,
                }
              : null
          }
          onStart={handleStart}
          onResumeStash={handleResumeStash}
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

    case "publish":
      return (
        <PublishView
          onPublish={handlePublish}
          onStash={handleStash}
          isPublishing={isPublishing}
          progress={publishProgress}
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
        <div className="flex flex-col items-center justify-center h-full gap-4 px-8 animate-in">
          <h2 className="text-xl font-semibold text-red">
            Something went wrong
          </h2>
          <p className="text-sm text-muted text-center max-w-md">
            {view.message}
          </p>
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
