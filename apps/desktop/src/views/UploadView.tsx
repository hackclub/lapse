import type { UploadProgress } from "../upload";

interface UploadViewProps {
  progress: UploadProgress;
}

export function UploadView({ progress }: UploadViewProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8">
      <h2 className="text-xl font-semibold">Uploading to Lapse</h2>

      <div className="w-full max-w-sm">
        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-red rounded-full transition-all duration-300"
            style={{ width: `${Math.round(progress.progress * 100)}%` }}
          />
        </div>
        <div className="text-center text-sm text-muted mt-3">
          {progress.stage}
        </div>
      </div>
    </div>
  );
}
