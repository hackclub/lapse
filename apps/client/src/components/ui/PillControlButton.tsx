import { ComponentProps, PropsWithChildren } from "react";

export function PillControlButton({
  children,
  ...props
}: PropsWithChildren<
  Pick<ComponentProps<"button">, "onClick" | "aria-label" | "aria-pressed" | "title" | "disabled">
>) {
  return (
    <button
      type="button"
      {...props}
      className="text-white min-w-12 min-h-12 rounded-full transition-all hover:scale-125 active:scale-95 cursor-pointer aria-pressed:bg-darkless focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}
