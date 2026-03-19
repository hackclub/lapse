import { useState, useEffect } from "react";
import { lapse } from "../lib/desktop";
import type { DesktopSource } from "@/shared/ipc-channels";

interface SourcePickerProps {
  selectedId: string | null;
  onSelect: (source: DesktopSource) => void;
}

export function SourcePicker({ selectedId, onSelect }: SourcePickerProps) {
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSources = () => {
    setIsLoading(true);
    setError(null);
    lapse
      .invoke("capture:get-sources")
      .then(result => {
        setSources(result);
        setIsLoading(false);
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : String(err));
        setIsLoading(false);
      });
  };

  useEffect(() => {
    fetchSources();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-neutral-400">Loading sources...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <p className="text-sm text-red-400">Failed to load sources</p>
        <button
          type="button"
          onClick={fetchSources}
          className="rounded-lg bg-neutral-800 px-4 py-2 text-sm text-white transition-colors hover:bg-neutral-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (sources.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <p className="text-sm text-neutral-400">No capture sources found</p>
        <button
          type="button"
          onClick={fetchSources}
          className="rounded-lg bg-neutral-800 px-4 py-2 text-sm text-white transition-colors hover:bg-neutral-700"
        >
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-neutral-300">Select a source</h3>
        <button
          type="button"
          onClick={fetchSources}
          className="text-xs text-neutral-500 transition-colors hover:text-neutral-300"
        >
          Refresh
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {sources.map(source => {
          const isSelected = source.id === selectedId;
          return (
            <button
              key={source.id}
              type="button"
              onClick={() => onSelect(source)}
              className={`group overflow-hidden rounded-xl border-2 transition-all ${
                isSelected
                  ? "border-red-500 bg-neutral-800"
                  : "border-transparent bg-neutral-800/50 hover:border-neutral-600 hover:bg-neutral-800"
              }`}
            >
              <div className="aspect-video w-full overflow-hidden bg-neutral-900">
                <img
                  src={source.thumbnailDataUrl}
                  alt={source.name}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="px-3 py-2">
                <p className="truncate text-xs font-medium text-neutral-300">{source.name}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
