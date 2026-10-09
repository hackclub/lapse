import clsx from "clsx";
import { DraftTimelapse, Timelapse } from "@hackclub/lapse-api";

import { TimelapseCard } from "@/components/entity/TimelapseCard";
import { useAdminView } from "@/hooks/useAdminView";

export function TimelapseGrid({ timelapses, className }: {
  timelapses: (Timelapse | DraftTimelapse)[];
  className?: string
}) {
  const adminView = useAdminView();

  // Admins can opt out of seeing hidden timelapses (e.g. while screen sharing). This also covers a cached feed that
  // outlived an admin session.
  const shown = adminView.enabled
    ? timelapses
    : timelapses.filter(x => x.isDraft || !adminView.isHiddenFromOthers(x));

  return (
    <div className={clsx("grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,22rem)] justify-between w-full gap-4 sm:gap-y-12", className)}>
      {shown.map(x => <TimelapseCard timelapse={x} key={x.id} />)}
    </div>
  );
}
