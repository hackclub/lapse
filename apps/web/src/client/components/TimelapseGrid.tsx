import clsx from "clsx";

import { Timelapse } from "@/client/api";
import { TimelapseCard } from "@/client/components/TimelapseCard";

export function TimelapseGrid({ timelapses, className }: {
  timelapses: Timelapse[];
  className?: string;
}) {
  return (
    <div className={clsx("grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,22rem)] justify-between w-full gap-4 sm:gap-y-12", className)}>
      {timelapses.map(timelapse => (
        <TimelapseCard timelapse={timelapse} key={timelapse.id} />
      ))}
    </div>
  );
}
