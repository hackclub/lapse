import Icon from "@hackclub/icons";
import clsx from "clsx";
import type { TimelapseVisibility } from "@hackclub/lapse-api";

import type { IconGlyph } from "@/common";

function VisibilityOption({ icon, title, description, selected, onClick, position, compact }: {
  icon: IconGlyph;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
  position: "first" | "second";
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex items-center cursor-pointer transition-colors",
        // Compact stays side-by-side at any width: a sheet is narrower than the
        // `sm` breakpoint, so the responsive stacking would always trigger and
        // cost twice the height for the same two choices.
        compact ? "w-1/2 gap-2.5 p-2.5" : "w-full sm:w-1/2 gap-4 p-4",
        position === "first" && !selected && (compact ? "border-r border-slate" : "border-b sm:border-b-0 sm:border-r border-slate"),
        selected ? "bg-red text-white" : "hover:bg-darkless"
      )}
    >
      <Icon glyph={icon} size={compact ? 26 : 48} className="shrink-0" />
      <div className={clsx("flex flex-col text-left", compact ? "min-w-0 pr-0" : "pr-2")}>
        <span className={clsx("font-bold", compact && "text-sm")}>{title}</span>
        <span className={clsx(compact ? "text-xs" : "text-sm", selected ? "text-white/80" : "text-muted")}>{description}</span>
      </div>
    </button>
  );
}

export function VisibilityPicker({ value, onChange, compact }: {
  value: TimelapseVisibility | null;
  onChange: (visibility: TimelapseVisibility) => void;

  /** Tighter metrics, for the Lookout publish panel - a sheet has far less room than a page. */
  compact?: boolean;
}) {
  return (
    <div className={clsx(
      "flex w-full border border-slate rounded-lg overflow-hidden",
      compact ? "flex-row" : "flex-col sm:flex-row"
    )}>
      <VisibilityOption
        icon="explore"
        title="Public"
        description="Make your timelapse visible to the world! Recommended!"
        selected={value === "PUBLIC"}
        onClick={() => onChange("PUBLIC")}
        position="first"
        compact={compact}
      />
      
      <VisibilityOption
        icon="private-fill"
        title="Unlisted"
        description="Only staff and people with the link will be able to access your timelapse."
        selected={value === "UNLISTED"}
        onClick={() => onChange("UNLISTED")}
        position="second"
        compact={compact}
      />
    </div>
  );
}
