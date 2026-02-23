import Icon from "@hackclub/icons";
import clsx from "clsx";

import { IconGlyph } from "./util";
import type { TimelapseVisibility } from "@/client/api";

function VisibilityOption({
    icon,
    title,
    description,
    selected,
    onClick,
    position
}: {
    icon: IconGlyph;
    title: string;
    description: string;
    selected: boolean;
    onClick: () => void;
    position: "first" | "second";
}) {
    return (
        <button
            onClick={onClick}
            className={clsx(
                "flex items-center gap-4 p-4 w-full sm:w-1/2 cursor-pointer transition-colors",
                position === "first" && !selected && "border-b sm:border-b-0 sm:border-r border-slate",
                selected ? "bg-red text-white" : "hover:bg-darkless"
            )}
        >
            <Icon glyph={icon} size={48} className="flex-shrink-0" />
            <div className="flex flex-col text-left pr-2">
                <span className="font-bold">{title}</span>
                <span className={clsx("text-sm", selected ? "text-white/80" : "text-muted")}>{description}</span>
            </div>
        </button>
    );
}

export function VisibilityPicker({
    value,
    onChange
}: {
    value: TimelapseVisibility | null;
    onChange: (visibility: TimelapseVisibility) => void;
}) {
    return (
        <div className="flex flex-col sm:flex-row w-full border border-slate rounded-lg overflow-hidden">
            <VisibilityOption
                icon="explore"
                title="Public"
                description="Make your timelapse visible to the world! Recommended!"
                selected={value === "PUBLIC"}
                onClick={() => onChange("PUBLIC")}
                position="first"
            />
            <VisibilityOption
                icon="private-fill"
                title="Unlisted"
                description="Only staff and people with the link will be able to access your timelapse."
                selected={value === "UNLISTED"}
                onClick={() => onChange("UNLISTED")}
                position="second"
            />
        </div>
    );
}
