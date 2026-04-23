interface TimelapseCardProps {
  title: string;
  duration: number;
  snapshotCount: number;
  startedAt: number;
  onClick?: () => void;
}

function formatRelativeDate(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatDurationShort(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function TimelapseCard({ title, duration, snapshotCount, startedAt, onClick }: TimelapseCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full rounded-xl border border-neutral-700/50 bg-neutral-800 p-4 text-left transition-colors hover:border-neutral-600 hover:bg-neutral-750"
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-medium text-white">{title}</h4>
          <p className="mt-1 text-xs text-neutral-400">
            {formatRelativeDate(startedAt)}
          </p>
        </div>
        <svg
          className="ml-2 h-4 w-4 shrink-0 text-neutral-600 transition-colors group-hover:text-neutral-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
      <div className="mt-3 flex items-center gap-4">
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <path strokeLinecap="round" d="M12 6v6l4 2" />
          </svg>
          {formatDurationShort(duration)}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 15l-5-5L5 21" />
          </svg>
          {snapshotCount} snapshots
        </span>
      </div>
    </button>
  );
}
