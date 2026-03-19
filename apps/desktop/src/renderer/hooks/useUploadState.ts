import { useState, useCallback } from "react";
import { lapse } from "../lib/desktop";
import { useIpcEvent } from "./useIpc";
import type { UploadProgress } from "@/shared/ipc-channels";

interface UploadState {
  isUploading: boolean;
  progress: Map<string, UploadProgress>;
  totalProgress: number;
  error: string | null;
  draftId: string | null;
  isComplete: boolean;
  startUpload: () => Promise<void>;
  cancelUpload: () => Promise<void>;
}

export function useUploadState(): UploadState {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<Map<string, UploadProgress>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);

  useIpcEvent("upload:progress", data => {
    setProgress(prev => {
      const next = new Map(prev);
      next.set(data.sessionId, data);
      return next;
    });
  });

  useIpcEvent("upload:complete", data => {
    setIsUploading(false);
    setIsComplete(true);
    setDraftId(data.draftId);
  });

  useIpcEvent("upload:error", data => {
    setIsUploading(false);
    setError(data.message);
  });

  const startUpload = useCallback(async () => {
    setIsUploading(true);
    setError(null);
    setIsComplete(false);
    setProgress(new Map());
    try {
      const result = await lapse.invoke("upload:start");
      setDraftId(result.draftId);
    } catch (err) {
      setIsUploading(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const cancelUpload = useCallback(async () => {
    await lapse.invoke("upload:cancel");
    setIsUploading(false);
  }, []);

  let totalProgress = 0;
  if (progress.size > 0) {
    let totalBytes = 0;
    let uploadedBytes = 0;
    for (const p of progress.values()) {
      totalBytes += p.bytesTotal;
      uploadedBytes += p.bytesUploaded;
    }
    totalProgress = totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 0;
  }

  return {
    isUploading,
    progress,
    totalProgress,
    error,
    draftId,
    isComplete,
    startUpload,
    cancelUpload
  };
}
