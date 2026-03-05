import clsx from "clsx";
import { PropsWithChildren } from "react";
import Icon from "@hackclub/icons";

import type { IconGlyph } from "@/common";

export type AlertVariant = "warning" | "error" | "info";

export function Alert({ children, variant, icon }: PropsWithChildren<{
    variant: AlertVariant,
    icon: IconGlyph
}>) {
    return (
        <div className={clsx(
            "flex items-center gap-3 p-4 rounded-lg border",
            variant === "warning" && "bg-yellow/10 border-yellow/20",
            variant === "error" && "bg-red/10 border-red/20",
            variant === "info" && "bg-blue/10 border-blue/20"
        )}>
            <Icon glyph={icon} size={32} className={clsx(
                "shrink-0",
                variant === "warning" && "text-yellow",
                variant === "error" && "text-red",
                variant === "info" && "text-blue"
            )} />
            <div className={clsx(
                variant === "warning" && "text-yellow",
                variant === "error" && "text-red",
                variant === "info" && "text-blue"
            )}>
                {children}
            </div>
        </div>
    );
}
