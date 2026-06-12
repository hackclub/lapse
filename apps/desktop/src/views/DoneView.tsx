import { openUrl } from "@tauri-apps/plugin-opener";

interface DoneViewProps {
  timelapseId: string;
  onRecordAnother: () => void;
}

export function DoneView({ timelapseId, onRecordAnother }: DoneViewProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 animate-in">
      <div className="text-center">
        <h2 className="text-2xl font-semibold mb-2">
          Your timelapse is live!
        </h2>
        <p className="text-muted text-sm">
          It may take a moment to finish processing.
        </p>
      </div>

      <div className="flex flex-col gap-3 w-48">
        <button
          onClick={() =>
            openUrl(`https://lapse.hackclub.com/timelapse/${timelapseId}`)
          }
          className="w-full py-2.5 bg-red text-white font-medium rounded-lg hover:brightness-110 transition-all"
        >
          View on Lapse
        </button>
        <button
          onClick={onRecordAnother}
          className="w-full py-2.5 border border-white/20 text-sm font-medium rounded-lg hover:bg-white/10 transition-colors"
        >
          Record Another
        </button>
      </div>
    </div>
  );
}
