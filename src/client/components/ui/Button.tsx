import clsx from "clsx";
import { PropsWithChildren } from "react";

const noop = () => {};

export function Button({ children, kind, isSquare, disabled, onClick }: PropsWithChildren<{
  kind?: "primary" | "secondary" | "dark",
  isSquare?: boolean,
  disabled?: boolean,
  onClick: () => void
}>) {
  kind ??= "primary";

  return (
    <button
      onClick={disabled ? noop : onClick}
      className={clsx(
        "rounded-2xl px-4 py-3 cursor-pointer font-bold transition-transform",
        (kind == "primary") && "bg-red text-white",
        (kind == "secondary") && "border-2 border-red text-red",
        (kind == "dark") && "bg-black text-white",
        disabled && "bg-smoke text-black",
        !disabled && "hover:scale-[102%] active:scale-[98%]",
        isSquare && "aspect-square"
      )}
    >{children}</button>
  );
}