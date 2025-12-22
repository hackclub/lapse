import clsx from "clsx";
import { ReactNode } from "react";

export function TimelapseGrid({ children, className }: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div className={clsx("grid grid-cols-[repeat(auto-fill,22rem)] justify-between w-full gap-y-12", className)}>
            {children}
        </div>
    );
}
