import clsx from "clsx";
import { PropsWithChildren } from "react";

export function Badge({ children, variant = "default", className }: PropsWithChildren<{
  variant?: "default" | "warning" | "success" | "error",
  className?: string
}>) {
  return (
    <span
      className={clsx(
        "inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold",
        variant === "default" && "bg-darkless text-white",
        variant === "warning" && "bg-yellow text-black",
        variant === "success" && "bg-green text-white",
        variant === "error" && "bg-red text-white",
        className
      )}
    >
      {children}
    </span>
  );
}
