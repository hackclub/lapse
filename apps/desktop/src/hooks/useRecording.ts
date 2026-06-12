import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

type Phase = "Idle" | "Recording" | "Paused" | "Encoding";

export function useRecording() {
  const [phase, setPhase] = useState<Phase>("Idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [latestFrameUrl, setLatestFrameUrl] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const snapshotRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const framePath = await invoke<string | null>(
          "recording_get_latest_frame"
        );
        if (framePath) {
          setLatestFrameUrl(framePath);
        }
        const secs = await invoke<number>("recording_get_elapsed");
        setElapsed(secs);
      } catch {
        // ignore polling errors
      }
    }, 1000);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (snapshotRef.current) {
      clearInterval(snapshotRef.current);
      snapshotRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const start = useCallback(
    async (sourceId: string, sourceKind: string) => {
      const result = await invoke<{ session_id: string }>("recording_start", {
        sourceId,
        sourceKind,
      });
      setSessionId(result.session_id);
      setPhase("Recording");
      setElapsed(0);
      setLatestFrameUrl(null);
      startPolling();

      // Tick snapshots every second
      snapshotRef.current = setInterval(async () => {
        try {
          await invoke("recording_tick_snapshot");
        } catch {
          // ignore
        }
      }, 1000);
    },
    [startPolling]
  );

  const pause = useCallback(async () => {
    await invoke("recording_pause");
    setPhase("Paused");
  }, []);

  const resume = useCallback(async () => {
    await invoke("recording_resume");
    setPhase("Recording");
  }, []);

  const stop = useCallback(async () => {
    stopPolling();
    const result = await invoke<{
      session_id: string;
      frame_count: number;
      snapshots: number[];
      elapsed_seconds: number;
    }>("recording_stop");
    setPhase("Idle");
    return result;
  }, [stopPolling]);

  return {
    phase,
    sessionId,
    latestFrameUrl,
    elapsed,
    start,
    pause,
    resume,
    stop,
  };
}
