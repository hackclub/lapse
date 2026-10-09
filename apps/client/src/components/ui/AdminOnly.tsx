import clsx from "clsx";
import { PropsWithChildren } from "react";
import type { Timelapse } from "@hackclub/lapse-api";

export type TimelapseStatus = "PUBLIC" | "UNLISTED" | "PROCESSING" | "FAILED";

const STATUS_STYLES: Record<TimelapseStatus, { label: string; className: string }> = {
  PUBLIC: { label: "Public", className: "bg-green/20 text-green" },
  UNLISTED: { label: "Unlisted", className: "bg-orange/20 text-orange" },
  PROCESSING: { label: "Processing", className: "bg-yellow/20 text-yellow" },
  FAILED: { label: "Failed", className: "bg-red/20 text-red" }
};

export function statusFromVisibility(visibility: string, isProcessing: boolean): TimelapseStatus {
  if (visibility === "FAILED_PROCESSING")
    return "FAILED";

  if (isProcessing)
    return "PROCESSING";

  return visibility === "PUBLIC" ? "PUBLIC" : "UNLISTED";
}

export function timelapseStatus(timelapse: Timelapse): TimelapseStatus {
  return statusFromVisibility(timelapse.visibility, timelapse.playbackUrl === null);
}

export function StatusBadge({ status, className }: {
  status: TimelapseStatus;
  className?: string;
}) {
  const style = STATUS_STYLES[status];

  return (
    <span
      className={clsx(
        "inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider",
        style.className,
        className
      )}
    >
      {style.label}
    </span>
  );
}

const EXTERNAL_ID_LINKS = {
  hackatime: { title: "Open in Telescreen", url: (id: string) => `https://telescreen.hackclub.com/subjects/${id}` },
  slack: { title: "Open in Slack", url: (id: string) => `https://hackclub.slack.com/team/${id}` }
};

export function ExternalIdLink({ kind, id, className }: {
  kind: keyof typeof EXTERNAL_ID_LINKS;
  id: string;
  className?: string;
}) {
  const link = EXTERNAL_ID_LINKS[kind];

  return (
    <a
      href={link.url(encodeURIComponent(id))}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      title={link.title}
      className={clsx("text-cyan hover:underline", className)}
    >
      {id}
    </a>
  );
}

export function HackatimeProjectLink({ hackatimeId, project, className }: {
  hackatimeId: string;
  project: string;
  className?: string;
}) {
  const params = new URLSearchParams({ u: hackatimeId, p: project });

  return (
    <a
      href={`https://telescreen.hackclub.com/workbench/hackatime/overview?${params}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      title="Open project in Telescreen"
      className={clsx("font-mono text-cyan hover:underline", className)}
    >
      {project}
    </a>
  );
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
