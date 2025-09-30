import { PropsWithChildren } from "react";
import clsx from "clsx";
import Icon from "@hackclub/icons";
import { IconGlyph } from "./util";

export function Modal({ children, title, description, icon, isOpen, setIsOpen }: PropsWithChildren<{
  isOpen: boolean,
  setIsOpen: (x: boolean) => void,
  icon: IconGlyph,
  title: string,
  description: string
}>) {
  return (
    <dialog className={clsx(
      "flex absolute w-screen h-screen p-8 top-0 left-0 text-text bg-[#00000022] justify-center items-center shadow z-10",
      !isOpen && "hidden"
    )}>
      <section className="flex flex-col bg-white w-1/2 min-w-[600px] max-h-full rounded-lg overflow-hidden">
        <header className="flex justify-between p-8 pb-4 border-b-1 border-sunken border-dashed">
          <div className="flex gap-4">
            <div className="p-2 border-1 border-sunken rounded-md flex w-12 h-12 justify-center">
              <Icon glyph={icon} size={32} />
            </div>
            
            <div className="flex flex-col">
              <h1 className="font-bold text-lg m-0">{title}</h1>
              <h2>{description}</h2>
            </div>
          </div>

          <div className="cursor-pointer flex items-center" onClick={() => setIsOpen(false)}>
            <Icon glyph="view-close" size={32} />
          </div>
        </header>

        <div className="flex flex-col p-8 pt-4 overflow-y-auto">
          {children}
        </div>
      </section>
    </dialog>
  );
}