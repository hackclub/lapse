export function Skeleton({ className, circular, lines = 1 }: {
  className?: string;
  lines?: number;
  circular?: boolean;
}) {
  className ??= "w-full";

  const rounding = circular ? "rounded-full" : "rounded-xl";

  if (lines === 1) {
    return (
      <span aria-hidden className={`inline-block h-4 bg-slate ${rounding} animate-pulse ${className}`} />
    );
  }

  return (
    <span aria-hidden className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <span
          key={i}
          className={`inline-block h-4 bg-slate ${rounding} animate-pulse ${i === lines - 1 ? "w-1/2" : "w-full"}`}
        />
      ))}
    </span>
  );
}
