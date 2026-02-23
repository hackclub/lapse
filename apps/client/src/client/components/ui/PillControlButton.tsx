import { IconGlyph } from "@/client/components/ui/util";
import Icon from "@hackclub/icons";
import { PropsWithChildren } from "react";

export function PillControlButton({ children, onClick }: PropsWithChildren<{
  onClick: () => void
}>) {
  return (
    <button
      onClick={onClick}
      className="text-white rounded-full transition-all hover:scale-125 active:scale-95 cursor-pointer"
    >
      {children}
    </button>
  )
}