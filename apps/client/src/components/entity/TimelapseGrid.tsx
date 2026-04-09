import clsx from "clsx";
import { DraftTimelapse, Timelapse } from "@hackclub/lapse-api";

import { TimelapseCard } from "@/components/entity/TimelapseCard";

export function TimelapseGrid({ timelapses, className }: {
  timelapses: (Timelapse | DraftTimelapse)[];
  className?: string
}) {
  return (
    <div className={clsx("grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,22rem)] justify-between w-full gap-4 sm:gap-y-12", className)}>
      {timelapses.map(x => <TimelapseCard timelapse={x} key={x.id} />)}
    </div>
  );
}
