import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

interface EncodingViewProps {
  frameCount: number;
}

export function EncodingView({ frameCount }: EncodingViewProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const unlisten = listen<number>("encoding:progress", (event) => {
      setProgress(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8 animate-in">
      <h2 className="text-xl font-semibold">Encoding your timelapse...</h2>

      <div className="w-full max-w-sm">
        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-red rounded-full transition-all duration-300"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <div className="text-center text-sm text-muted mt-3">
          {Math.round(progress * 100)}% &mdash; {frameCount} frames
        </div>
      </div>
    </div>
  );
}
