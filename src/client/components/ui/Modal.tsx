import { PropsWithChildren, ReactNode } from "react";
import clsx from "clsx";
import Icon from "@hackclub/icons";
import { IconGlyph } from "./util";

export function Modal({
  children,
  isOpen,
  className,
  size
}: PropsWithChildren<{
  isOpen: boolean;
  setIsOpen?: (x: boolean) => void;
  className?: string;
  size?: "SMALL" | "REGULAR"
}>) {
  size ??= "REGULAR";

  return (
    <div role="dialog" className={clsx(
      "flex absolute w-screen h-screen p-8 top-0 left-0 text-text bg-[#00000088] duration-500 transition-colors justify-center items-center shadow z-10",
      !isOpen && "hidden",
      className
    )}>
      <section className={clsx(
        "flex flex-col bg-dark text-smoke max-h-full rounded-lg overflow-hidden transition-transform",
        isOpen && "scale-100",
        !isOpen && "scale-0",
        size == "SMALL"   && "w-1/3 min-w-[100px]",
        size == "REGULAR" && "w-1/2 min-w-[600px]"
      )}>
        {children}
      </section>
    </div>
  );
}

export function ModalHeader({
  icon,
  title,
  description,
  children,
  showCloseButton,
  onClose
}: {
  icon?: IconGlyph;
  title?: string;
  description?: string;
  children?: ReactNode;
  showCloseButton?: boolean;
  onClose?: () => void;
}) {
  return (
    <header className="flex justify-between p-8 pb-4 border-b-1 border-black border-dashed">
      <div className="flex gap-4 flex-1">
        {
          icon && (
            <div className="p-2 border-1 border-black rounded-md flex w-12 h-12 justify-center">
              <Icon glyph={icon} size={32} />
            </div>
          )
        }

        <div className="flex flex-col flex-1">
          { title && <h1 className="font-bold text-lg m-0">{title}</h1> }
          { description && <h2>{description}</h2> }
          { children }
        </div>
      </div>

      {
        (showCloseButton && onClose) && (
          <div className="flex items-center ml-4">
            <ModalCloseButton onClick={onClose} />
          </div>
        )
      }
    </header>
  );
}

export function ModalCloseButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="cursor-pointer flex items-center" onClick={onClick}>
      <Icon glyph="view-close" size={32} />
    </div>
  );
}

export function ModalContent({ children, className }: PropsWithChildren<{ className?: string }>) {
  return (
    <div className={clsx("flex flex-col p-8 pt-4 overflow-y-auto", className)}>
      {children}
    </div>
  );
}