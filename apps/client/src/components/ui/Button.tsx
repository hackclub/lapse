import clsx from "clsx";
import { JSX, PropsWithChildren, type MouseEvent } from "react";
import Icon from "@hackclub/icons";

import type { IconGlyph } from "@/common";
import { navigateTo } from "@/navigation";
import { useRouter } from "next/router";

export type ButtonKind =
  "primary" |
  "regular" |
  "destructive" |
  "error";

export function Button({ children, kind, disabled, onClick, href, className, icon, title }: PropsWithChildren<
  {
    kind?: ButtonKind,
    disabled?: boolean,
    className?: string,
    icon?: IconGlyph | JSX.Element,

    /** A tooltip for the button. Doubles as the accessible name for buttons that are nothing but an icon. */
    title?: string
  } & (
    { href?: undefined, onClick: () => void } |
    { href: string, onClick?: undefined }
  )
>) {
  const router = useRouter();

  kind ??= "regular";

  function handleClick(e: MouseEvent) {
    if (disabled)
      return;

    if (href) {
      navigateTo(router, href, e);
      return;
    }

    onClick?.();
  }

  function handleAuxClick(e: MouseEvent) {
    if (!disabled && href && e.button === 1) {
      navigateTo(router, href, e);
    }
  }

  return (
    <button
      onClick={handleClick}
      onAuxClick={handleAuxClick}
      title={title}
      aria-label={!children ? title : undefined}
      className={clsx(
        "flex items-center gap-2 justify-center rounded-2xl h-12 font-bold text-nowrap flex-nowrap",
        children ? "px-8" : "w-12",
        "cursor-pointer transition-all",
        (kind == "primary") && "bg-red text-white",
        (kind == "regular") && "bg-dark border-slate border shadow text-white",
        (kind == "destructive") && "bg-dark border-red border shadow text-red",
        (kind == "error") && "border-red border shadow text-red",
        (kind == "error" && disabled) && "border-slate",
        (kind != "error" && disabled) && "bg-darkless!",
        (!disabled) && "hover:scale-[102%] active:scale-[98%]",
        className
      )}
    >
      { icon &&
        (
          typeof icon === "string"
            ? <Icon glyph={icon} width={children ? 20 : 36} height={children ? 20 : 36} />
            : icon
        )
      }
      {children}
    </button>
  );
}