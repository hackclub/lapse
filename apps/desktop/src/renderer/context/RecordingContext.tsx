import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { lapse } from "../lib/desktop";
import type { CaptureStatus } from "@/shared/ipc-channels";

interface RecordingContextValue {
  status: CaptureStatus;
  startRecording: (sourceId: string) => Promise<void>;
  stopRecording: () => Promise<void>;
  pauseRecording: () => Promise<void>;
  resumeRecording: () => Promise<void>;
}

const RecordingContext = createContext<RecordingContextValue | null>(null);

export function RecordingProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CaptureStatus>({ state: "idle" });

  useEffect(() => {
    lapse.invoke("capture:status").then(setStatus).catch(() => {});
    const unsub = lapse.on("capture:status-changed", setStatus);
    return unsub;
  }, []);

  const startRecording = useCallback(async (sourceId: string) => {
    await lapse.invoke("capture:start", sourceId);
    const s = await lapse.invoke("capture:status");
    setStatus(s);
  }, []);

  const stopRecording = useCallback(async () => {
    await lapse.invoke("capture:stop");
    const s = await lapse.invoke("capture:status");
    setStatus(s);
  }, []);

  const pauseRecording = useCallback(async () => {
    await lapse.invoke("capture:pause");
    const s = await lapse.invoke("capture:status");
    setStatus(s);
  }, []);

  const resumeRecording = useCallback(async () => {
    await lapse.invoke("capture:resume");
    const s = await lapse.invoke("capture:status");
    setStatus(s);
  }, []);

  return (
    <RecordingContext.Provider
      value={{ status, startRecording, stopRecording, pauseRecording, resumeRecording }}
    >
      {children}
    </RecordingContext.Provider>
  );
}

export function useRecording(): RecordingContextValue {
  const ctx = useContext(RecordingContext);
  if (!ctx) {
    throw new Error("useRecording must be used within a RecordingProvider");
  }
  return ctx;
}
