
export function Skeleton({ className, lines = 1 }: {
  className: string;
  lines?: number;
}) {
  if (lines === 1) {
    return (
      <span className={`inline-block h-4 bg-slate rounded-xl animate-pulse ${className}`} />
    );
  }

  return (
    <span className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <span
          key={i}
          className={`inline-block h-4 bg-slate rounded-xl animate-pulse ${i === lines - 1 ? "w-1/2" : "w-full"}`}
        />
      ))}
    </span>
  );
}
