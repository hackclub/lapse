import clsx from "clsx";
import { PropsWithChildren } from "react";

export function Button({ children, kind, isSquare, onClick }: PropsWithChildren<{
  kind?: "primary" | "secondary" | "dark",
  isSquare?: boolean,
  onClick: () => void
}>) {
  kind ??= "primary";

  return (
    <button
      onClick={onClick}
      className={clsx(
        "rounded-2xl px-4 py-3 cursor-pointer font-bold hover:scale-[102%] active:scale-[98%] transition-transform",
        (kind == "primary") && "bg-red text-white",
        (kind == "secondary") && "border-2 border-red text-red",
        (kind == "dark") && "bg-black text-white",
        isSquare && "aspect-square"
      )}
    >{children}</button>
  );
}