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
      "flex fixed w-screen h-screen p-4 sm:p-8 top-0 left-0 text-text bg-[#00000088] duration-500 transition-colors justify-center items-center shadow z-20",
      !isOpen && "hidden",
      className
    )}>
      <section className={clsx(
        "flex flex-col bg-dark text-smoke max-h-full rounded-lg overflow-hidden transition-transform",
        isOpen && "scale-100",
        !isOpen && "scale-0",
        size == "SMALL"   && "sm:w-1/3 sm:min-w-25",
        size == "REGULAR" && "sm:w-1/2 sm:min-w-150"
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
  shortDescription,
  children,
  showCloseButton,
  onClose
}: {
  icon?: IconGlyph;
  title?: string;
  description?: string;
  shortDescription?: string;
  children?: ReactNode;
  showCloseButton?: boolean;
  onClose?: () => void;
}) {
  shortDescription ??= description;

  return (
    <header className="flex justify-between sm:p-6 p-8 pb-4 border-b border-black border-dashed">
      <div className="flex gap-4 flex-1">
        {
          icon && (
            <div className="p-2 border border-black rounded-md w-12 h-12 justify-center flex">
              <Icon glyph={icon} size={32} />
            </div>
          )
        }

        <div className="flex flex-col flex-1">
          { title && <h1 className="font-bold text-lg m-0">{title}</h1> }
          { description && <h2 className="hidden sm:block">{description}</h2> }
          { shortDescription && <h2 className="sm:hidden block">{shortDescription}</h2> }
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