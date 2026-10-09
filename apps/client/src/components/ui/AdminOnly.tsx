import clsx from "clsx";
import { PropsWithChildren } from "react";
import type { Timelapse } from "@hackclub/lapse-api";

/**
 * Describes why an admin-only timelapse is hidden from everyone else.
 */
export function hiddenTimelapseReason(timelapse: Timelapse) {
  if (timelapse.visibility === "FAILED_PROCESSING")
    return "Failed";

  if (timelapse.playbackUrl === null && timelapse.blocker === null)
    return "Processing";

  return "Unlisted";
}

/**
 * Marks content that's only shown to the viewer because of their elevated permissions.
 */
export function AdminOnly({ children, className }: PropsWithChildren<{
  className?: string
}>) {
  return (
    <div className={clsx("border-2 border-dashed border-orange bg-orange/10 rounded-lg sm:rounded-2xl", className)}>
      {children}
    </div>
  );
}

/**
 * A pill explaining why an `AdminOnly` item is visible to the viewer.
 */
export function AdminBadge({ children, className }: PropsWithChildren<{
  className?: string
}>) {
  return (
    <span
      className={clsx(
        "inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-orange/20 text-orange",
        className
      )}
    >
      {children}
    </span>
  );
}
