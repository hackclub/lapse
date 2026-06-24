import { PropsWithChildren, ReactNode } from "react";
import Icon from "@hackclub/icons";

import type { IconGlyph } from "@/common";

export function InputField({ label, description, icon, children }: PropsWithChildren<{
  label: string,
  description: ReactNode,
  icon?: IconGlyph,
}>) {
  return (
    <div className="flex flex-col w-full">
      <div className="flex items-center gap-2">
        {icon && <Icon glyph={icon} size={24} className="text-muted shrink-0" />}
        <label className="font-bold wrap-break-word">{label}</label>
      </div>
      <div className="flex items-start gap-2">
        {icon && <div className="w-6 shrink-0" />}
        <div className="flex flex-col w-full">
          <p className="text-muted mb-3">{description}</p>
          {children}
        </div>
      </div>
    </div>
  );
}
