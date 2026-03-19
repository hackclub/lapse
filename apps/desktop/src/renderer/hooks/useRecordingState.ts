import { useState, useEffect } from "react";
import { useRecording } from "../context/RecordingContext";

interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  isIdle: boolean;
  elapsedSeconds: number;
  formattedTime: string;
  snapshotCount: number;
  sourceName: string | null;
  statusLabel: string;
  statusColor: string;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function useRecordingState(): RecordingState {
  const { status } = useRecording();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const isRecording = status.state === "recording";
  const isPaused = status.state === "paused";
  const isIdle = status.state === "idle";
  const startedAt = status.state !== "idle" ? status.startedAt : 0;

  useEffect(() => {
    if (!isRecording) {
      if (isIdle) setElapsedSeconds(0);
      return;
    }

    const tick = () => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isRecording, isIdle, startedAt]);

  const snapshotCount = status.state !== "idle" ? status.snapshotCount : 0;
  const sourceName = status.state !== "idle" ? status.sourceName : null;

  let statusLabel: string;
  let statusColor: string;
  if (isRecording) {
    statusLabel = "Recording";
    statusColor = "text-red-500";
  } else if (isPaused) {
    statusLabel = "Paused";
    statusColor = "text-amber-500";
  } else {
    statusLabel = "Idle";
    statusColor = "text-neutral-400";
  }

  return {
    isRecording,
    isPaused,
    isIdle,
    elapsedSeconds,
    formattedTime: formatDuration(elapsedSeconds),
    snapshotCount,
    sourceName,
    statusLabel,
    statusColor
  };
}
