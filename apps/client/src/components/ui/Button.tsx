import clsx from "clsx";
import { PropsWithChildren } from "react";
import { IconGlyph } from "./util";
import Icon from "@hackclub/icons";
import Link from "next/link";
import { useRouter } from "next/router";

export type ButtonKind =
  "primary" |
  "regular" |
  "destructive";

export function Button({ children, kind, disabled, onClick, href, className, icon }: PropsWithChildren<
  {
    kind?: ButtonKind,
    disabled?: boolean,
    className?: string,
    icon?: IconGlyph
  } & (
    { href?: undefined, onClick: () => void } |
    { href: string, onClick?: undefined }
  )
>) {
  const router = useRouter();

  kind ??= "regular";

  if (href) {
    onClick = () => router.push(href);
  }

  return (
    <button
      onClick={disabled ? undefined : onClick}
      className={clsx(
        "flex items-center gap-2 justify-center rounded-2xl h-12 px-8 font-bold text-nowrap flex-nowrap",
        "cursor-pointer transition-all",
        (kind == "primary") && "bg-red text-white",
        (kind == "regular") && "bg-dark border-slate border shadow text-white",
        (kind == "destructive") && "bg-dark border-red border shadow text-red",
        (disabled) && "!bg-darkless",
        (!disabled) && "hover:scale-[102%] active:scale-[98%]",
        className
      )}
    >
      {icon ? <Icon glyph={icon} width={20} height={20} /> : undefined}
      {children}
    </button>
  );
}